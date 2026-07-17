import prisma from "./prisma.js";

export async function deadLetter({
  companyId,
  source,
  channel,
  leadId = null,
  refId = null,
  payload,
  error,
  attempts = 1,
}) {
  try {
    if (!companyId || !payload) return null;
    return await prisma.deadLetter.create({
      data: {
        companyId,
        source,
        channel,
        leadId,
        refId,
        payload,
        error: String(error || "Unknown error").slice(0, 2000),
        attempts,
      },
    });
  } catch (e) {
    console.error("[DLQ] Failed to record dead letter:", e?.message || e);
    return null;
  }
}

export async function listDeadLetters(companyId, { status, refId, limit = 100 } = {}) {
  return prisma.deadLetter.findMany({
    where: {
      companyId,
      ...(status ? { status } : {}),
      ...(refId ? { refId } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: Math.min(Number(limit) || 100, 500),
  });
}

export async function countByStatus(companyId) {
  const rows = await prisma.deadLetter.groupBy({
    by: ["status"],
    where: { companyId },
    _count: { _all: true },
  });
  return rows.reduce((acc, r) => ({ ...acc, [r.status]: r._count._all }), {});
}

export async function replayDeadLetter(companyId, id) {
  const row = await prisma.deadLetter.findFirst({ where: { id, companyId } });
  if (!row) return { success: false, reason: "Not found" };
  if (row.status !== "PENDING") {
    return { success: false, reason: `Already ${row.status.toLowerCase()}` };
  }

  const { MessagingService } = await import("../services/messaging-service.js");
  const { getMessagingConfig } = await import("./messaging-config.js");
  const { smtpConfig, smsConfig } = await getMessagingConfig(companyId);

  const payload = row.payload || {};
  let result;

  try {
    if (row.channel === "SMS") {
      result = await MessagingService.sendSms({
        companyId,
        to: payload.to,
        body: payload.body,
        smsConfig,
        addOptOut: false,
      });
      if (result?.blocked) {
        return { success: false, reason: result.reason || "Blocked by compliance" };
      }
    } else {
      result = await MessagingService.sendEmail({
        companyId,
        to: payload.to,
        subject: payload.subject,
        html: payload.html,
        fromName: payload.fromName || undefined,
        smtpConfig,
      });
      if (result?.blocked) {
        return { success: false, reason: result.reason || "Blocked by compliance" };
      }
      if (!result?.success) {
        return { success: false, reason: result?.error || "Send failed again" };
      }
    }
  } catch (e) {
    await prisma.deadLetter.update({
      where: { id },
      data: { attempts: { increment: 1 }, error: String(e?.message || e).slice(0, 2000) },
    });
    return { success: false, reason: e?.message || "Replay failed" };
  }

  await prisma.deadLetter.update({
    where: { id },
    data: { status: "REPLAYED", replayedAt: new Date(), attempts: { increment: 1 } },
  });

  if (row.leadId) {
    await prisma.leadTimeline.create({
      data: {
        leadId: row.leadId,
        type: row.channel === "SMS" ? "SMS_SENT" : "EMAIL_SENT",
        description: `Replayed a previously failed ${row.channel.toLowerCase()} send`,
        metadata: { deadLetterId: id, source: row.source, refId: row.refId },
      },
    });
  }

  return { success: true };
}

export async function discardDeadLetter(companyId, id) {
  const row = await prisma.deadLetter.findFirst({ where: { id, companyId } });
  if (!row) return { success: false, reason: "Not found" };

  await prisma.deadLetter.update({
    where: { id },
    data: { status: "DISCARDED" },
  });
  return { success: true };
}
