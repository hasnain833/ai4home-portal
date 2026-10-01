export async function nextTicketNumber(tx, companyId) {
  if (!companyId) return null;
  const { ticketCounter } = await tx.company.update({
    where: { id: companyId },
    data: { ticketCounter: { increment: 1 } },
    select: { ticketCounter: true },
  });
  return ticketCounter;
}

export function ticketRef(ticket) {
  if (ticket?.number) return `WC-${ticket.number}`;
  // Only a ticket with no company has no number.
  return `#${String(ticket?.id || "").slice(-6).toUpperCase()}`;
}
