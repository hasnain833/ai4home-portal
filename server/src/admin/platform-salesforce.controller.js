// Super Admin → Salesforce: connect AI4Home's own org and sync Business Leads with it.
import prisma from "../lib/prisma.js";
import { encrypt, decryptSafe } from "../lib/crypto.js";
import { denyUnlessAdminAccess } from "../middlewares/auth.js";
import { writeAuditLog } from "../lib/audit.js";
import { B2B_LEAD_STATUSES } from "../lib/b2b.js";
import { SalesforceClient, generateCodeVerifier, codeChallengeFromVerifier } from "../services/salesforce-service.js";
import {
  appCredentials,
  clearPlatformSalesforceConnection,
  platformSalesforceClient,
  platformSalesforceConnection,
  platformSalesforceSettings,
  platformSalesforceSyncState,
  savePlatformSalesforceConnection,
  savePlatformSalesforceSettings,
  PlatformSalesforceError,
  PLATFORM_SYNC_LOG_ID,
} from "../lib/platform-salesforce.js";
import {
  CUSTOM_LEAD_FIELDS,
  leadFields,
  leadStatuses,
  pendingCounts,
  resyncEverything,
  suggestStatusMap,
  shortError,
} from "../services/b2b-salesforce-sync.js";
import { requestPlatformSalesforceSync } from "../inngest/functions/salesforce-cron.js";

const API = "/services/data/v59.0";
// What the sync itself needs; the access check shows the rest for information.
const NEEDED = { Lead: ["read", "create", "edit", "delete"], Event: ["read", "create", "edit", "delete"], Task: ["create"] };
const CHECKED_OBJECTS = ["Lead", "Event", "Task", "Contact", "Account", "Opportunity", "Campaign", "CampaignMember", "User"];

const portalUrl = () => process.env.NEXT_PUBLIC_URL || "";
// The Connected App already allows this URL for builders; the state says which flow it is.
const redirectUri = () => `${portalUrl()}/api/sales/salesforce/callback`;
const loginBase = (environment) => (environment === "production" ? "https://login.salesforce.com" : "https://test.salesforce.com");

const wrap = (label, fn) => async (req, res) => {
  try {
    if (denyUnlessAdminAccess(req, res)) return;
    await fn(req, res);
  } catch (error) {
    if (error instanceof PlatformSalesforceError) return res.status(400).json({ message: error.message });
    console.error(`[Platform Salesforce] ${label} failed:`, error.message);
    res.status(500).json({ message: `${label} failed: ${shortError(error)}` });
  }
};

export const getPlatformSalesforce = wrap("Loading Salesforce", async (_req, res) => {
  const { clientId, clientSecret } = appCredentials();
  const [conn, settings, state, pending, logs] = await Promise.all([
    platformSalesforceConnection(),
    platformSalesforceSettings(),
    platformSalesforceSyncState(),
    pendingCounts(),
    prisma.syncLog.findMany({ where: { companyId: PLATFORM_SYNC_LOG_ID }, orderBy: { createdAt: "desc" }, take: 20 }),
  ]);
  res.json({
    available: !!(clientId && clientSecret),
    connection: conn
      ? { instanceUrl: conn.instanceUrl, environment: conn.environment, identity: conn.identity, connectedAt: conn.connectedAt, connectedBy: conn.connectedBy, error: conn.error }
      : null,
    settings,
    lastRun: state.lastRun || null,
    pending,
    logs,
  });
});

export const connectPlatformSalesforce = wrap("Connecting Salesforce", async (req, res) => {
  const { clientId, clientSecret } = appCredentials();
  if (!clientId || !clientSecret) return res.status(503).json({ message: "Salesforce isn't set up on this server yet (SALESFORCE_CLIENT_ID / SALESFORCE_CLIENT_SECRET)." });
  if (!process.env.NEXT_PUBLIC_URL) return res.status(503).json({ message: "NEXT_PUBLIC_URL is required for the Salesforce sign-in." });
  const environment = req.body?.environment === "production" ? "production" : "sandbox";
  const codeVerifier = generateCodeVerifier();
  // Encrypted, so the public callback can trust it.
  const state = encrypt(JSON.stringify({ platform: true, environment, codeVerifier, userId: req.user.id, name: req.user.name || req.user.email }));
  res.json({
    url: SalesforceClient.getAuthorizationUrl({ clientId, redirectUri: redirectUri(), environment, state, codeChallenge: codeChallengeFromVerifier(codeVerifier) }),
  });
});

/** Called by the shared Salesforce callback when the state is the platform's. Returns where to send the browser. */
export async function finishPlatformSalesforceConnect(stateData, code) {
  const done = (query) => `${portalUrl()}/admin/salesforce?${query}`;
  try {
    const { clientId, clientSecret } = appCredentials();
    const tokens = await SalesforceClient.exchangeCodeForTokens({
      code,
      clientId,
      clientSecret,
      redirectUri: redirectUri(),
      environment: stateData.environment,
      codeVerifier: stateData.codeVerifier,
    });
    const client = new SalesforceClient(tokens.instance_url, tokens.access_token);
    const [user, org] = await Promise.all([
      client.apiRequest("/services/oauth2/userinfo").catch(() => ({})),
      client.query("SELECT Name, IsSandbox FROM Organization LIMIT 1").then((r) => r.records?.[0]).catch(() => null),
    ]);
    await savePlatformSalesforceConnection({
      tokens,
      environment: stateData.environment,
      identity: { user: user.name || null, username: user.preferred_username || null, org: org?.Name || null, orgId: user.organization_id || null },
      connectedBy: stateData.name || null,
    });
    await writeAuditLog({ req: { user: { id: stateData.userId, email: stateData.name } }, action: "platform_salesforce.connected", targetType: "PlatformSetting", targetId: "platform.salesforce", metadata: { org: org?.Name || null, environment: stateData.environment } });
    return done("connected=1");
  } catch (error) {
    console.error("[Platform Salesforce] Connect failed:", error.message);
    return done(`sf_error=${encodeURIComponent(shortError(error))}`);
  }
}

export const disconnectPlatformSalesforce = wrap("Disconnecting Salesforce", async (req, res) => {
  const conn = await platformSalesforceConnection();
  if (conn) {
    // Best effort: tell Salesforce to drop the token too.
    await fetch(`${loginBase(conn.environment)}/services/oauth2/revoke`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: decryptSafe(conn.refreshToken) }).toString(),
    }).catch(() => {});
  }
  await clearPlatformSalesforceConnection();
  const settings = await platformSalesforceSettings();
  await savePlatformSalesforceSettings({ ...settings, enabled: false });
  await writeAuditLog({ req, action: "platform_salesforce.disconnected", targetType: "PlatformSetting", targetId: "platform.salesforce" });
  res.json({ ok: true });
});

/** Asks Salesforce what this connection may read and write, plus the Lead statuses and our optional fields. */
export const checkPlatformSalesforceAccess = wrap("Checking access", async (_req, res) => {
  const client = await platformSalesforceClient();
  const [global, fields, statuses, limits] = await Promise.all([
    client.apiRequest(`${API}/sobjects`),
    leadFields(client),
    leadStatuses(client).catch(() => []),
    client.apiRequest(`${API}/limits`).catch(() => null),
  ]);
  const byName = new Map((global.sobjects || []).map((o) => [o.name, o]));
  const objects = CHECKED_OBJECTS.map((name) => {
    const o = byName.get(name);
    const rights = o ? { read: !!o.queryable, create: !!o.createable, edit: !!o.updateable, delete: !!o.deletable } : { read: false, create: false, edit: false, delete: false };
    const missing = (NEEDED[name] || []).filter((r) => !rights[r]);
    return { name, label: o?.label || name, ...rights, neededBySync: !!NEEDED[name], missing };
  });
  res.json({
    objects,
    ready: objects.every((o) => !o.missing.length),
    customFields: CUSTOM_LEAD_FIELDS.map((f) => ({ ...f, present: !!fields.get(f.name.toLowerCase())?.updateable })),
    leadStatuses: statuses,
    suggestedStatusMap: suggestStatusMap(statuses),
    apiCalls: limits?.DailyApiRequests ? { max: limits.DailyApiRequests.Max, remaining: limits.DailyApiRequests.Remaining } : null,
  });
});

export const updatePlatformSalesforceSettings = wrap("Saving settings", async (req, res) => {
  const current = await platformSalesforceSettings();
  const body = req.body || {};
  const statusMap = { ...current.statusMap };
  if (body.statusMap && typeof body.statusMap === "object") {
    for (const status of B2B_LEAD_STATUSES) {
      const value = body.statusMap[status];
      if (value === undefined) continue;
      statusMap[status] = value ? String(value).slice(0, 255) : null;
    }
  }
  const enabled = body.enabled === undefined ? current.enabled : !!body.enabled;
  if (enabled && !(await platformSalesforceConnection())) return res.status(400).json({ message: "Connect Salesforce first." });
  const next = { ...current, statusMap, enabled };
  await savePlatformSalesforceSettings(next);
  await writeAuditLog({ req, action: "platform_salesforce.settings_updated", targetType: "PlatformSetting", targetId: "platform.salesforce.settings", metadata: { enabled, statusMap } });
  if (enabled && !current.enabled) await requestPlatformSalesforceSync();
  res.json(next);
});

export const syncPlatformSalesforceNow = wrap("Starting the sync", async (_req, res) => {
  const settings = await platformSalesforceSettings();
  if (!settings.enabled) return res.status(400).json({ message: "Turn the sync on first." });
  await requestPlatformSalesforceSync();
  res.json({ ok: true });
});

export const resyncPlatformSalesforce = wrap("Starting a full resync", async (req, res) => {
  const settings = await platformSalesforceSettings();
  if (!settings.enabled) return res.status(400).json({ message: "Turn the sync on first." });
  await resyncEverything();
  await writeAuditLog({ req, action: "platform_salesforce.resync", targetType: "PlatformSetting", targetId: "platform.salesforce" });
  await requestPlatformSalesforceSync();
  res.json({ ok: true });
});
