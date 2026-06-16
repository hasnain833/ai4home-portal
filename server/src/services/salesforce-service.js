import prisma from "../lib/prisma.js";
import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

// ─── Encryption Helpers ───────────────────────────────────────────────────────

const ALGORITHM = "aes-256-gcm";
const ENCRYPTION_KEY = process.env.SALESFORCE_ENCRYPTION_KEY || "change_me_to_a_32_char_hex_key_00";

function getKeyBuffer() {
  // Ensure key is exactly 32 bytes
  const key = ENCRYPTION_KEY.padEnd(32, "0").slice(0, 32);
  return Buffer.from(key, "utf-8");
}

export function encrypt(text) {
  const iv = randomBytes(16);
  const cipher = createCipheriv(ALGORITHM, getKeyBuffer(), iv);
  let encrypted = cipher.update(text, "utf8", "hex");
  encrypted += cipher.final("hex");
  const authTag = cipher.getAuthTag().toString("hex");
  return `${iv.toString("hex")}:${authTag}:${encrypted}`;
}

export function decrypt(encryptedText) {
  try {
    const [ivHex, authTagHex, encrypted] = encryptedText.split(":");
    if (!ivHex || !authTagHex || !encrypted) return encryptedText; // Not encrypted, return as-is
    const decipher = createDecipheriv(ALGORITHM, getKeyBuffer(), Buffer.from(ivHex, "hex"));
    decipher.setAuthTag(Buffer.from(authTagHex, "hex"));
    let decrypted = decipher.update(encrypted, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
  } catch {
    // If decryption fails, return the raw value (migration safety)
    return encryptedText;
  }
}

// ─── Default Field Mappings ───────────────────────────────────────────────────

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

// ─── Salesforce Client ────────────────────────────────────────────────────────

export class SalesforceClient {
  constructor(instanceUrl, accessToken) {
    this.instanceUrl = instanceUrl;
    this.accessToken = accessToken;
  }

  /**
   * Generate the OAuth 2.0 authorization URL for the Salesforce login page.
   */
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
    });

    return `${baseUrl}/services/oauth2/authorize?${queryParams.toString()}`;
  }

  /**
   * Exchange an authorization code for access + refresh tokens.
   */
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

  /**
   * Refresh an expired access token using the refresh token.
   */
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

  // ─── Instance Methods ─────────────────────────────────────────────────────

  async apiRequest(path, options = {}) {
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
      const errorBody = await res.text();
      throw new Error(`Salesforce API error (${res.status}): ${errorBody}`);
    }

    // Handle 204 No Content responses
    if (res.status === 204) return {};

    return res.json();
  }

  /**
   * Execute a SOQL query via REST API.
   */
  async query(soql) {
    return this.apiRequest(
      `/services/data/v59.0/query?q=${encodeURIComponent(soql)}`
    );
  }

  /**
   * Fetch next page of query results.
   */
  async queryMore(nextRecordsUrl) {
    return this.apiRequest(nextRecordsUrl);
  }

  /**
   * Create a Bulk API 2.0 query job.
   */
  async createBulkQueryJob(soql) {
    return this.apiRequest("/services/data/v59.0/jobs/query", {
      method: "POST",
      body: JSON.stringify({
        operation: "query",
        query: soql,
      }),
    });
  }

  /**
   * Check the status of a Bulk API 2.0 job.
   */
  async getBulkJobStatus(jobId) {
    return this.apiRequest(`/services/data/v59.0/jobs/query/${jobId}`);
  }

  /**
   * Get results of a completed Bulk API 2.0 query job as CSV text.
   */
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

  /**
   * Update a record in Salesforce (for write-back).
   */
  async updateRecord(sObjectType, recordId, data) {
    await this.apiRequest(`/services/data/v59.0/sobjects/${sObjectType}/${recordId}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    });
  }

  /**
   * Test the connection by querying the user identity.
   */
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

// ─── Helper: Get authenticated client from DB ─────────────────────────────────

export async function getAuthenticatedClient(companyId) {
  const connection = await prisma.salesforceConnection.findUnique({
    where: { companyId },
  });

  if (!connection || !connection.isActive) return null;

  let accessToken = decrypt(connection.accessToken);
  const refreshToken = decrypt(connection.refreshToken);
  const clientSecret = decrypt(connection.clientSecret);

  // Check if token is expired (with a 5 minute buffer)
  const tokenExpiry = new Date(connection.tokenExpiresAt);
  const now = new Date();
  const bufferMs = 5 * 60 * 1000;

  if (now.getTime() > tokenExpiry.getTime() - bufferMs) {
    // Token is expired or about to expire — refresh it
    try {
      const refreshResult = await SalesforceClient.refreshAccessToken({
        refreshToken,
        clientId: connection.clientId,
        clientSecret,
        environment: connection.environment,
      });

      accessToken = refreshResult.access_token;

      // Update the stored tokens
      await prisma.salesforceConnection.update({
        where: { companyId },
        data: {
          accessToken: encrypt(accessToken),
          instanceUrl: refreshResult.instance_url || connection.instanceUrl,
          tokenExpiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000), // SF tokens last ~2 hours
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

// ─── Field Mapping Transformation ─────────────────────────────────────────────

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

    // Handle consent field inversions
    if (mapping.isConsentField) {
      if (portalField === "emailOptIn") {
        // Salesforce HasOptedOutOfEmail is inverted — true means opted OUT
        lead.emailOptIn = !rawValue;
      } else if (portalField === "smsOptIn") {
        lead.smsOptIn = !!rawValue;
      }
      continue;
    }

    if (LEAD_FIELDS.has(portalField)) {
      lead[portalField] = rawValue;
    } else {
      // Store in customFields JSON
      customFields[portalField] = rawValue;
    }
  }

  // Include Salesforce record ID as externalId
  if (sfRecord.Id) {
    lead.externalId = sfRecord.Id;
  }

  if (Object.keys(customFields).length > 0) {
    lead.customFields = customFields;
  }

  return lead;
}

// ─── Bulk CSV Parser ──────────────────────────────────────────────────────────

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
        i++; // Skip escaped quote
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

// ─── Seed Default Mappings ────────────────────────────────────────────────────

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
