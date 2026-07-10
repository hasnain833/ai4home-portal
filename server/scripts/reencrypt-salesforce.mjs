/**
 * One-time migration: re-encrypt stored Salesforce connection secrets from the
 * OLD key to the current SALESFORCE_ENCRYPTION_KEY.
 *
 * Why: tokens were originally sealed with the public default key. Once you set a
 * strong SALESFORCE_ENCRYPTION_KEY, existing rows can no longer be decrypted at
 * runtime — run this once to decrypt with the old key and re-encrypt with the new.
 *
 * Usage (from repo root, with server/.env loaded):
 *   OLD_SALESFORCE_ENCRYPTION_KEY="<old key, default 'change_me_to_a_32_char_hex_key_00'>" \
 *   SALESFORCE_ENCRYPTION_KEY="<new strong 32-char key>" \
 *   node server/scripts/reencrypt-salesforce.mjs [--dry-run]
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

const ALGORITHM = "aes-256-gcm";
const DEFAULT_KEY = "change_me_to_a_32_char_hex_key_00";
const OLD_KEY = process.env.OLD_SALESFORCE_ENCRYPTION_KEY || DEFAULT_KEY;
const NEW_KEY = process.env.SALESFORCE_ENCRYPTION_KEY || "";
const DRY_RUN = process.argv.includes("--dry-run");

const keyBuf = (k) => Buffer.from(k.padEnd(32, "0").slice(0, 32), "utf-8");
const ENC_RE = /^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/i;

function decryptWith(key, text) {
  const [ivHex, tagHex, ct] = String(text).split(":");
  const d = createDecipheriv(ALGORITHM, keyBuf(key), Buffer.from(ivHex, "hex"));
  d.setAuthTag(Buffer.from(tagHex, "hex"));
  return d.update(ct, "hex", "utf8") + d.final("utf8");
}

function encryptWith(key, text) {
  const iv = randomBytes(12);
  const c = createCipheriv(ALGORITHM, keyBuf(key), iv);
  const enc = c.update(String(text), "utf8", "hex") + c.final("hex");
  return `${iv.toString("hex")}:${c.getAuthTag().toString("hex")}:${enc}`;
}

// Re-encrypt one field: decrypt with old key (skip if not encrypted), encrypt with new.
function rotate(value) {
  if (!value || !ENC_RE.test(value)) return value; // plaintext/empty — leave as-is
  return encryptWith(NEW_KEY, decryptWith(OLD_KEY, value));
}

async function main() {
  if (!NEW_KEY || NEW_KEY === DEFAULT_KEY) {
    console.error("Refusing to run: set SALESFORCE_ENCRYPTION_KEY to a strong, non-default key first.");
    process.exit(1);
  }
  if (OLD_KEY === NEW_KEY) {
    console.error("OLD and NEW keys are identical — nothing to rotate.");
    process.exit(1);
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 3 });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

  const conns = await prisma.salesforceConnection.findMany();
  console.log(`Found ${conns.length} Salesforce connection(s). ${DRY_RUN ? "(dry-run)" : ""}`);

  let updated = 0;
  for (const c of conns) {
    try {
      const data = {
        accessToken: rotate(c.accessToken),
        refreshToken: rotate(c.refreshToken),
        clientSecret: rotate(c.clientSecret),
      };
      if (!DRY_RUN) {
        await prisma.salesforceConnection.update({ where: { id: c.id }, data });
      }
      updated += 1;
      console.log(`  ✓ ${DRY_RUN ? "would re-encrypt" : "re-encrypted"} connection ${c.id} (company ${c.companyId})`);
    } catch (e) {
      console.error(`  ✗ connection ${c.id} failed (wrong OLD key?): ${e.message}`);
    }
  }

  console.log(`Done. ${updated}/${conns.length} ${DRY_RUN ? "eligible" : "updated"}.`);
  await prisma.$disconnect();
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
