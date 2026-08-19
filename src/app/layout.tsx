import type { Metadata } from "next";
import { DM_Sans, Cormorant_Garamond } from "next/font/google";
import { ThemeProvider } from "@/components/ThemeProvider";
import { AuthProvider } from "@/contexts/AuthContext";
import { ConfirmDialogProvider } from "@/components/ui/confirm-dialog";
import { Toaster } from "sonner";
import "./globals.css";

// Both families are referenced by globals.css. Loading them here is what makes
// the reference resolve — self-hosted by next/font, so no render-blocking
// request to Google and no flash of fallback text.
const dmSans = DM_Sans({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-dm-sans",
});

const cormorant = Cormorant_Garamond({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
  variable: "--font-cormorant",
});

export const metadata: Metadata = {
  title: "Aiforhomebuilder",
  description: "AI-powered warranty management for homebuilders",
  icons: {
    icon: "/logo-light.svg",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${dmSans.variable} ${cormorant.variable}`}
    >
      <body className="antialiased">
        <AuthProvider>
          <ThemeProvider>
            <ConfirmDialogProvider>{children}</ConfirmDialogProvider>
          </ThemeProvider>
        </AuthProvider>
        <Toaster richColors position="top-right" />
      </body>
    </html>
  );
}
