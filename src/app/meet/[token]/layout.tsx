import type { Metadata } from "next";

// What a phone, email app or chat shows when the booking link is shared. Without this the
// page inherits the warranty product's title and description from the root layout.
const title = "Book a time with AI for Homebuilders";
const description = "Pick a 15-minute slot that suits you. We'll show how leads get answered in minutes.";

export const metadata: Metadata = {
  title,
  description,
  // Preview images need an absolute address.
  ...(process.env.NEXT_PUBLIC_URL ? { metadataBase: new URL(process.env.NEXT_PUBLIC_URL) } : {}),
  openGraph: { title, description, siteName: "AI for Homebuilders", type: "website" },
  twitter: { card: "summary_large_image", title, description },
  robots: { index: false },
};

export default function MeetLayout({ children }: { children: React.ReactNode }) {
  return children;
}
