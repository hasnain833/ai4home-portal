import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Mirrors server/src/lib/ticket-number.js — the readable per-company number.
export function ticketRef(ticket: { id: string; number?: number | null }) {
  return ticket.number ? `WC-${ticket.number}` : `#${ticket.id.slice(-6).toUpperCase()}`;
}
