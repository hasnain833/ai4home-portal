import prisma from "./prisma.js";
import { MailService } from "../services/mail-service.js";
import { getMessagingConfig } from "./messaging-config.js";

const ALERT_ACTION = "FAILURE_ALERT";

const threshold = () =>
  Math.max(1, parseInt(process.env.SYNC_FAILURE_ALERT_THRESHOLD || "3", 10));
const cooldownHours = () =>
  Math.max(1, parseInt(process.env.SYNC_FAILURE_ALERT_COOLDOWN_HOURS || "24", 10));

async function resolveRecipients(companyId) {
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: {
      name: true,
      email: true,
      users: { where: { role: "ADMIN" }, select: { email: true } },
    },
  });
  if (!company) return { company: null, recipients: [] };

  const recipients = company.users.map((u) => u.email).filter(Boolean);
  if (recipients.length === 0 && company.email) recipients.push(company.email);

  return { company, recipients: [...new Set(recipients)] };
}

function alertHtml({ companyName, streak, action, lastMessage, lastErrors }) {
  const errorList = lastErrors.length
    ? `<ul style="margin:8px 0 0 0;padding-left:18px;color:#475569;">${lastErrors
        .slice(0, 5)
        .map((e) => `<li>${String(e).slice(0, 200)}</li>`)
        .join("")}</ul>`
    : "";

  return `
    <div style="font-family:'Helvetica Neue',Arial,sans-serif;max-width:600px;margin:0 auto;border:1px solid #eaeaea;border-radius:12px;overflow:hidden;">
      <div style="background:#7f1d1d;padding:24px 40px;">
        <h1 style="color:#fff;margin:0;font-size:20px;">Salesforce sync is failing</h1>
      </div>
      <div style="padding:32px 40px;color:#334155;line-height:1.7;font-size:15px;">
        <p><strong>${companyName || "Your account"}</strong> has had
        <strong>${streak} consecutive ${action} failures</strong>. New and updated
        leads are <strong>not reaching the portal</strong> until this is resolved.</p>
        <p style="margin-top:20px;"><strong>Most recent error</strong></p>
        <p style="background:#f8fafc;border-left:3px solid #b91c1c;padding:12px 16px;margin:8px 0 0 0;color:#475569;font-size:14px;">
          ${String(lastMessage || "No message recorded").slice(0, 400)}
        </p>
        ${errorList}
        <p style="margin-top:24px;"><strong>What to check</strong></p>
        <ul style="padding-left:18px;color:#475569;">
          <li>Has the Salesforce connection expired or been revoked? Reconnect it in Settings → Integrations.</li>
          <li>Did the connected app's credentials or permissions change?</li>
          <li>Is the org over its API request limit?</li>
        </ul>
        <p style="margin-top:24px;font-size:13px;color:#94a3b8;">
          You'll only get one of these every ${cooldownHours()}h while the failure persists.
        </p>
      </div>
    </div>`;
}

export async function maybeAlertOnSyncFailure(companyId, { action = "sync" } = {}) {
  try {
    if (!companyId) return { alerted: false, reason: "no-company" };

    const limit = threshold();
    const recent = await prisma.syncLog.findMany({
      where: { companyId, action: { not: ALERT_ACTION } },
      orderBy: { createdAt: "desc" },
      take: limit,
    });

    if (recent.length < limit) return { alerted: false, reason: "not-enough-history" };
    if (!recent.every((r) => r.status === "ERROR")) {
      return { alerted: false, reason: "no-streak" };
    }

    const since = new Date(Date.now() - cooldownHours() * 60 * 60 * 1000);
    const recentAlert = await prisma.syncLog.findFirst({
      where: { companyId, action: ALERT_ACTION, createdAt: { gte: since } },
    });
    if (recentAlert) return { alerted: false, reason: "cooldown" };

    const { company, recipients } = await resolveRecipients(companyId);
    if (recipients.length === 0) {
      console.warn(
        `[Sync Alert][SW-CRM-007] ${limit} consecutive failures for company ${companyId} but no admin email to notify.`,
      );
      return { alerted: false, reason: "no-recipient" };
    }

    const latest = recent[0];
    const lastErrors = Array.isArray(latest?.metadata?.errors) ? latest.metadata.errors : [];

    console.error(
      `[Sync Alert][SW-CRM-007] ${limit} consecutive ${action} failures for company ${companyId} — notifying ${recipients.join(", ")}.`,
    );

    const { smtpConfig } = await getMessagingConfig(companyId);

    await MailService.sendEmail({
      to: recipients.join(","),
      subject: `[Action needed] Salesforce sync is failing — ${company?.name || companyId}`,
      html: alertHtml({
        companyName: company?.name,
        streak: recent.length,
        action,
        lastMessage: latest?.message,
        lastErrors,
      }),
      smtpConfig,
    });

    await prisma.syncLog.create({
      data: {
        companyId,
        direction: "OUTBOUND",
        action: ALERT_ACTION,
        status: "SUCCESS",
        message: `Alerted ${recipients.length} admin(s) after ${recent.length} consecutive ${action} failures.`,
        metadata: { recipients, streak: recent.length, alertedFor: action },
      },
    });

    return { alerted: true, recipients, streak: recent.length };
  } catch (error) {
    console.error("[Sync Alert] Failed to evaluate/send alert:", error?.message || error);
    return { alerted: false, error: error?.message || String(error) };
  }
}
