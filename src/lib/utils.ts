import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function calculateWarrantyYear(coeDate: Date | string | null): number {
  if (!coeDate) return 1;
  const coe = new Date(coeDate);
  const now = new Date();
  const diffTime = now.getTime() - coe.getTime();
  const diffYears = diffTime / (1000 * 60 * 60 * 24 * 365.25);
  
  if (diffYears < 0) return 0; // Pre-occupancy
  if (diffYears <= 1) return 1;
  if (diffYears <= 2) return 2;
  return 10; // Structural
}
