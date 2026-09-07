export const COVERAGE = {
  VALID: "VALID",
  EXPIRED: "EXPIRED",
  UNKNOWN: "UNKNOWN",
};

export function startOfDay(value) {
  const d = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  d.setHours(0, 0, 0, 0);
  return d;
}

export function getCoverageStatus(property, now = new Date()) {
  const end = property?.coverageTerm ? startOfDay(property.coverageTerm) : null;
  if (!end) {
    return { status: COVERAGE.UNKNOWN, endDate: null, daysRemaining: null };
  }

  const today = startOfDay(now);
  const msPerDay = 24 * 60 * 60 * 1000;
  const daysRemaining = Math.round((end.getTime() - today.getTime()) / msPerDay);

  return {
    status: end.getTime() >= today.getTime() ? COVERAGE.VALID : COVERAGE.EXPIRED,
    endDate: end,
    daysRemaining,
  };
}

export function formatCoverageDate(date) {
  if (!date) return null;
  return new Date(date).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export function describeCoverage(coverage) {
  if (!coverage || coverage.status === COVERAGE.UNKNOWN) return "";

  const when = formatCoverageDate(coverage.endDate);
  if (coverage.status === COVERAGE.EXPIRED) {
    return `Your warranty coverage on this home ended on ${when}. I can still answer questions and log a request for the warranty team to review, though coverage decisions will be up to them.`;
  }
  return `Your warranty coverage on this home runs through ${when}.`;
}
