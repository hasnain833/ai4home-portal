import prisma from "./prisma.js";

export async function generateTicketId() {
  // Find the most recently created ticket that uses our custom T- format
  const lastTicket = await prisma.ticket.findFirst({
    where: {
      id: {
        startsWith: "T-",
      },
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  let nextNum = 1;

  if (lastTicket) {
    // Extract the number from T-XXXXX
    const parsed = parseInt(lastTicket.id.replace("T-", ""), 10);
    if (!isNaN(parsed)) {
      nextNum = parsed + 1;
    }
  } else {
    // Fallback: If no T- tickets exist yet, start from total count + 1
    // to smoothly transition from older CUIDs.
    const totalCount = await prisma.ticket.count();
    nextNum = totalCount + 1;
  }

  // Format as T-00001
  return `T-${nextNum.toString().padStart(5, "0")}`;
}
