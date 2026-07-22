import prisma from "../lib/prisma.js";
import { randomBytes, createHash } from "crypto";
import { encrypt, decryptSafe } from "../lib/crypto.js";

export { encrypt };
export const decrypt = decryptSafe;

export function generateCodeVerifier() {
  return randomBytes(32).toString("base64url");
}

export function codeChallengeFromVerifier(verifier) {
  return createHash("sha256").update(verifier).digest("base64url");
}

export const DEFAULT_FIELD_MAPPINGS = [
  { salesforceField: "FirstName", portalField: "firstName", description: "First name of the lead" },
  { salesforceField: "LastName", portalField: "lastName", description: "Last name of the lead" },
  { salesforceField: "Email", portalField: "email", description: "Primary email address" },
  { salesforceField: "MobilePhone", portalField: "phone", description: "Mobile phone in E.164" },
  { salesforceField: "MailingStreet", portalField: "street", description: "Address street" },
  { salesforceField: "MailingCity", portalField: "city", description: "Address city" },
  { salesforceField: "MailingState", portalField: "state", description: "Address state" },
  { salesforceField: "MailingPostalCode", portalField: "zipCode", description: "Zip / Postal code" },
  { salesforceField: "HasOptedOutOfEmail", portalField: "emailOptIn", description: "Email opt-in state (inverted)", isConsentField: true },
  { salesforceField: "SMSConsentOptIn__c", portalField: "smsOptIn", description: "Custom SMS consent field", isConsentField: true },
];

export class SalesforceClient {
  constructor(instanceUrl, accessToken) {
    this.instanceUrl = instanceUrl;
    this.accessToken = accessToken;
  }

  static getAuthorizationUrl(params) {
    const baseUrl =
      params.environment === "production"
        ? "https://login.salesforce.com"
        : "https://test.salesforce.com";

    const queryParams = new URLSearchParams({
      response_type: "code",
      client_id: params.clientId,
      redirect_uri: params.redirectUri,
      scope: "api refresh_token",
      ...(params.state ? { state: params.state } : {}),
      ...(params.codeChallenge
        ? { code_challenge: params.codeChallenge, code_challenge_method: "S256" }
        : {}),
    });

    return `${baseUrl}/services/oauth2/authorize?${queryParams.toString()}`;
  }

  static async exchangeCodeForTokens(params) {
    const baseUrl =
      params.environment === "production"
        ? "https://login.salesforce.com"
        : "https://test.salesforce.com";

    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code: params.code,
      client_id: params.clientId,
      client_secret: params.clientSecret,
      redirect_uri: params.redirectUri,
      ...(params.codeVerifier ? { code_verifier: params.codeVerifier } : {}),
    });

    const res = await fetch(`${baseUrl}/services/oauth2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });

    if (!res.ok) {
      const errorBody = await res.text();
      throw new Error(`Salesforce token exchange failed (${res.status}): ${errorBody}`);
    }

    return res.json();
  }

  static async refreshAccessToken(params) {
    const baseUrl =
      params.environment === "production"
        ? "https://login.salesforce.com"
        : "https://test.salesforce.com";

    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: params.refreshToken,
      client_id: params.clientId,
      client_secret: params.clientSecret,
    });

    const res = await fetch(`${baseUrl}/services/oauth2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });

    if (!res.ok) {
      const errorBody = await res.text();
      throw new Error(`Salesforce token refresh failed (${res.status}): ${errorBody}`);
    }

    return res.json();
  }

  async apiRequest(path, options = {}, attempt = 0) {
    const MAX_RETRIES = 4;
    const url = `${this.instanceUrl}${path}`;
    const res = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        "Content-Type": "application/json",
        ...options.headers,
      },
    });

    if (!res.ok) {
      const retryable = res.status === 429 || res.status >= 500;
      if (retryable && attempt < MAX_RETRIES) {
        const retryAfter = Number(res.headers.get("retry-after"));
        const backoffMs = Number.isFinite(retryAfter) && retryAfter > 0
          ? retryAfter * 1000
          : Math.min(2 ** attempt * 500, 8000) + Math.floor(Math.random() * 250);
        await new Promise((r) => setTimeout(r, backoffMs));
        return this.apiRequest(path, options, attempt + 1);
      }
      const errorBody = await res.text();
      throw new Error(`Salesforce API error (${res.status}): ${errorBody}`);
    }

    if (res.status === 204) return {};

    return res.json();
  }

  async query(soql) {
    return this.apiRequest(
      `/services/data/v59.0/query?q=${encodeURIComponent(soql)}`
    );
  }

  async queryMore(nextRecordsUrl) {
    return this.apiRequest(nextRecordsUrl);
  }

  async queryAll(soql) {
    return this.apiRequest(
      `/services/data/v59.0/queryAll?q=${encodeURIComponent(soql)}`
    );
  }

  async describeSObjectFields(sObjectType) {
    const describe = await this.apiRequest(
      `/services/data/v59.0/sobjects/${sObjectType}/describe`
    );
    const names = new Set();
    for (const f of describe.fields || []) {
      if (f?.name) names.add(f.name.toLowerCase());
    }
    return names;
  }

  async createBulkQueryJob(soql) {
    return this.apiRequest("/services/data/v59.0/jobs/query", {
      method: "POST",
      body: JSON.stringify({
        operation: "query",
        query: soql,
      }),
    });
  }

  async getBulkJobStatus(jobId) {
    return this.apiRequest(`/services/data/v59.0/jobs/query/${jobId}`);
  }

  async getBulkQueryResults(jobId) {
    const url = `${this.instanceUrl}/services/data/v59.0/jobs/query/${jobId}/results`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        Accept: "text/csv",
      },
    });

    if (!res.ok) {
      throw new Error(`Bulk query results fetch failed (${res.status})`);
    }

    return res.text();
  }

  async updateRecord(sObjectType, recordId, data) {
    await this.apiRequest(`/services/data/v59.0/sobjects/${sObjectType}/${recordId}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    });
  }

  async testConnection() {
    try {
      const result = await this.apiRequest(
        "/services/data/v59.0/chatter/users/me"
      );
      return {
        ok: true,
        message: "Connection verified",
        identity: result.display_name || result.email,
      };
    } catch (e) {
      return { ok: false, message: e.message || "Connection test failed" };
    }
  }
}


export async function getAuthenticatedClient(companyId) {
  const connection = await prisma.salesforceConnection.findUnique({
    where: { companyId },
  });

  if (!connection || !connection.isActive) return null;

  let accessToken = decrypt(connection.accessToken);
  const refreshToken = decrypt(connection.refreshToken);
  const clientSecret = decrypt(connection.clientSecret);
  const tokenExpiry = new Date(connection.tokenExpiresAt);
  const now = new Date();
  const bufferMs = 5 * 60 * 1000;

  if (now.getTime() > tokenExpiry.getTime() - bufferMs) {
    try {
      const refreshResult = await SalesforceClient.refreshAccessToken({
        refreshToken,
        clientId: connection.clientId,
        clientSecret,
        environment: connection.environment,
      });

      accessToken = refreshResult.access_token;

      await prisma.salesforceConnection.update({
        where: { companyId },
        data: {
          accessToken: encrypt(accessToken),
          instanceUrl: refreshResult.instance_url || connection.instanceUrl,
          tokenExpiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000), 
        },
      });
    } catch (error) {
      console.error("[Salesforce] Token refresh failed:", error);
      return null;
    }
  }

  return {
    client: new SalesforceClient(connection.instanceUrl, accessToken),
    connection,
  };
}


export function mapSalesforceRecordToLead(sfRecord, mappings) {
  const lead = {};
  const customFields = {};

  const LEAD_FIELDS = new Set([
    "firstName", "lastName", "email", "phone",
    "street", "city", "state", "zipCode",
    "emailOptIn", "smsOptIn", "status",
  ]);

  for (const mapping of mappings) {
    const rawValue = sfRecord[mapping.salesforceField];
    if (rawValue === undefined || rawValue === null) continue;

    const portalField = mapping.portalField;

    if (mapping.isConsentField) {
      if (portalField === "emailOptIn") {
        lead.emailOptIn = !rawValue;
      } else if (portalField === "smsOptIn") {
        lead.smsOptIn = !!rawValue;
      }
      continue;
    }

    if (LEAD_FIELDS.has(portalField)) {
      lead[portalField] = rawValue;
    } else {
      customFields[portalField] = rawValue;
    }
  }

  if (sfRecord.Id) {
    lead.externalId = sfRecord.Id;
  }

  if (Object.keys(customFields).length > 0) {
    lead.customFields = customFields;
  }

  return lead;
}

export async function filterQueryableFields(client, sObjectType, fields) {
  try {
    const existing = await client.describeSObjectFields(sObjectType);
    if (!existing || existing.size === 0) return { fields, skipped: [] };
    const kept = [];
    const skipped = [];
    for (const f of fields) {
      if (existing.has(String(f).toLowerCase())) kept.push(f);
      else skipped.push(f);
    }
    if (kept.length === 0) return { fields, skipped: [] };
    return { fields: kept, skipped };
  } catch (e) {
    console.warn(
      `[Salesforce] describe(${sObjectType}) failed; querying unfiltered fields:`,
      e?.message || e,
    );
    return { fields, skipped: [] };
  }
}


export function parseBulkCSV(csvText) {
  const lines = csvText.trim().split("\n");
  if (lines.length < 2) return [];

  const headers = parseCSVLine(lines[0]);
  const records = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    const record = {};
    for (let j = 0; j < headers.length; j++) {
      record[headers[j]] = values[j] || "";
    }
    records.push(record);
  }

  return records;
}

function parseCSVLine(line) {
  const result = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      result.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}


export async function seedDefaultMappings(companyId) {
  for (const mapping of DEFAULT_FIELD_MAPPINGS) {
    await prisma.salesforceFieldMapping.upsert({
      where: {
        companyId_salesforceField: {
          companyId,
          salesforceField: mapping.salesforceField,
        },
      },
      create: {
        companyId,
        salesforceField: mapping.salesforceField,
        portalField: mapping.portalField,
        description: mapping.description,
        isConsentField: mapping.isConsentField || false,
      },
      update: {},
    });
  }
}
