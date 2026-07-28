import type { Metadata } from "next";
import { ThemeProvider } from "@/components/ThemeProvider";
import { AuthProvider } from "@/contexts/AuthContext";
import { ConfirmDialogProvider } from "@/components/ui/confirm-dialog";
import { Toaster } from "sonner";
import "./globals.css";

export const metadata: Metadata = {
  title: "Aiforhomebuilder",
  description: "AI-powered warranty management for homebuilders",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
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
