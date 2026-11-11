// AI4Home's own Salesforce org, connected by the Super Admin. Builders' orgs live in SalesforceConnection.
import prisma from "./prisma.js";
import { encrypt, decryptSafe } from "./crypto.js";
import { SalesforceClient } from "../services/salesforce-service.js";

const CONNECTION_KEY = "platform.salesforce";
const SETTINGS_KEY = "platform.salesforce.settings";
const SYNC_KEY = "platform.salesforce.sync";
// SyncLog has no company relation; this id keeps the platform org's history apart.
export const PLATFORM_SYNC_LOG_ID = "platform";
// Salesforce doesn't say when an access token expires; the org default session is 2 hours.
const TOKEN_TTL_MS = 2 * 60 * 60 * 1000;

const read = async (key) => (await prisma.platformSetting.findUnique({ where: { key } }))?.value || null;
const write = (key, value) =>
  value === null
    ? prisma.platformSetting.deleteMany({ where: { key } })
    : prisma.platformSetting.upsert({ where: { key }, create: { key, value }, update: { value } });

export const appCredentials = () => ({ clientId: process.env.SALESFORCE_CLIENT_ID, clientSecret: process.env.SALESFORCE_CLIENT_SECRET });

export const platformSalesforceConnection = () => read(CONNECTION_KEY);

export async function savePlatformSalesforceConnection({ tokens, environment, identity, connectedBy }) {
  await write(CONNECTION_KEY, {
    instanceUrl: tokens.instance_url,
    accessToken: encrypt(tokens.access_token),
    refreshToken: encrypt(tokens.refresh_token),
    tokenExpiresAt: new Date(Date.now() + TOKEN_TTL_MS).toISOString(),
    environment,
    identity,
    connectedBy: connectedBy || null,
    connectedAt: new Date().toISOString(),
    error: null,
  });
}

export const clearPlatformSalesforceConnection = () => write(CONNECTION_KEY, null);

/** Sync is off until the Super Admin has checked access and the status mapping. */
export async function platformSalesforceSettings() {
  return { enabled: false, statusMap: {}, ...((await read(SETTINGS_KEY)) || {}) };
}
export const savePlatformSalesforceSettings = (value) => write(SETTINGS_KEY, value);

export const platformSalesforceSyncState = async () => (await read(SYNC_KEY)) || {};
export const savePlatformSalesforceSyncState = (value) => write(SYNC_KEY, value);

export class PlatformSalesforceError extends Error {}

/** A ready client for AI4Home's org, refreshing the token when it's due. Throws when it needs reconnecting. */
export async function platformSalesforceClient() {
  const conn = await platformSalesforceConnection();
  if (!conn) throw new PlatformSalesforceError("Salesforce isn't connected.");
  let accessToken = decryptSafe(conn.accessToken);
  if (Date.now() > new Date(conn.tokenExpiresAt).getTime() - 5 * 60 * 1000) {
    const { clientId, clientSecret } = appCredentials();
    try {
      const refreshed = await SalesforceClient.refreshAccessToken({
        refreshToken: decryptSafe(conn.refreshToken),
        clientId,
        clientSecret,
        environment: conn.environment,
      });
      accessToken = refreshed.access_token;
      conn.accessToken = encrypt(accessToken);
      conn.instanceUrl = refreshed.instance_url || conn.instanceUrl;
      conn.tokenExpiresAt = new Date(Date.now() + TOKEN_TTL_MS).toISOString();
      conn.error = null;
      await write(CONNECTION_KEY, conn);
    } catch (error) {
      conn.error = "Salesforce refused to renew access. Disconnect and connect again.";
      await write(CONNECTION_KEY, conn);
      console.error("[Platform Salesforce] Token refresh failed:", error.message);
      throw new PlatformSalesforceError(conn.error);
    }
  }
  return new SalesforceClient(conn.instanceUrl, accessToken);
}
