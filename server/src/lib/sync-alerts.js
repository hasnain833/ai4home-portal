import prisma from "./prisma.js";
import { MailService } from "../services/mail-service.js";
import { getMessagingConfig } from "./messaging-config.js";
import { Templates } from "../services/templates.js";

const ALERT_ACTION = "FAILURE_ALERT";

// Alert after 3 consecutive sync failures, then stay quiet about the same
// company for a day so a persistent outage doesn't become an inbox flood.
const threshold = () => 3;
const cooldownHours = () => 24;

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

  return Templates.getSyncAlertEmail(
    companyName,
    streak,
    action,
    String(lastMessage || "No message recorded").slice(0, 400),
    errorList,
    cooldownHours()
  );
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
      // An integration-broken alert has to reach the admin even when the reason
      // the workspace is misconfigured is that it never set up SMTP either.
      allowPlatformSender: true,
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
