// Turns a campaign's tracked MessageUsage rows into the analytics page payload.
// ponytail: aggregates in memory; move to SQL GROUP BY if a campaign passes ~50k sends.

const DAY_MS = 24 * 60 * 60 * 1000;

function tally(rows) {
  const sent = rows.filter((r) => r.outcome === "sent");
  const has = (field) => sent.filter((r) => r[field]).length;
  return {
    sent: sent.length,
    emailsSent: sent.filter((r) => r.channel === "EMAIL").length,
    failed: rows.length - sent.length + has("failedAt"),
    delivered: has("deliveredAt"),
    opened: has("openedAt"),
    clicked: has("clickedAt"),
    replied: has("repliedAt"),
    booked: has("bookedAt"),
  };
}

const dayKey = (d) => new Date(d).toISOString().slice(0, 10);

function median(values) {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * rows: MessageUsage rows for one campaign.
 * steps: the campaign's steps (DELAY steps are skipped).
 * enrolledAt: { [leadId]: Date } — when each booked lead entered the campaign.
 */
export function summarizeCampaign({ rows, steps, enrolledAt = {}, days, now = new Date() }) {
  const trend = [];
  const byDay = new Map();
  for (let i = days - 1; i >= 0; i--) {
    const point = { date: dayKey(now.getTime() - i * DAY_MS), sent: 0, opened: 0, clicked: 0, replied: 0, booked: 0 };
    trend.push(point);
    byDay.set(point.date, point);
  }
  const bump = (at, key) => {
    const point = at && byDay.get(dayKey(at));
    if (point) point[key] += 1;
  };
  for (const r of rows) {
    if (r.outcome !== "sent") continue;
    bump(r.createdAt, "sent");
    bump(r.openedAt, "opened");
    bump(r.clickedAt, "clicked");
    bump(r.repliedAt, "replied");
    bump(r.bookedAt, "booked");
  }

  const bookDays = rows
    .filter((r) => r.bookedAt && enrolledAt[r.leadId])
    .map((r) => (new Date(r.bookedAt) - new Date(enrolledAt[r.leadId])) / DAY_MS);
  const med = median(bookDays);

  return {
    funnel: tally(rows),
    steps: steps
      .filter((s) => s.type !== "DELAY")
      .map((s) => ({
        id: s.id,
        position: s.position,
        type: s.type,
        label: s.subject || String(s.body || "").slice(0, 80),
        enabled: s.enabled !== false,
        ...tally(rows.filter((r) => r.stepId === s.id)),
      })),
    trend,
    timeToBook: { medianDays: med === null ? null : Math.round(med * 10) / 10, bookings: bookDays.length },
  };
}
