"use client";

import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import WarrantyChat from "@/components/warranty/WarrantyChat";

export default function WidgetPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const companyId = (params?.companyId as string) || "demo-company";
  const qColor = searchParams.get("botColor");
  const qName = searchParams.get("botName");
  const qLogo = searchParams.get("botLogo");
  const mode = searchParams.get("mode") === "fullscreen" ? "fullscreen" : "widget";

  const hasBrandingParams = !!(qColor || qName || qLogo);
  const [themeColor, setThemeColor] = useState(qColor || "#0F3B3D");
  const [botName, setBotName] = useState(qName || "Warranty Assistant");
  const [logoUrl, setLogoUrl] = useState(qLogo || "");
  const [loading, setLoading] = useState(!hasBrandingParams);

  useEffect(() => {
    if (hasBrandingParams) return;

    const fetchBranding = async () => {
      try {
        const response = await fetch(
          `/api/company/branding?id=${encodeURIComponent(companyId)}&v=${Date.now()}`,
          { cache: "no-store" }
        );
        if (response.ok) {
          const data = await response.json();
          if (data) {
            if (data.botColor) setThemeColor(data.botColor);
            if (data.name) {
              setBotName(`${data.name} Assistant`);
            }
            if (data.logo) setLogoUrl(data.logo);
          }
        }
      } catch (error) {
        console.error("Failed to fetch company branding:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchBranding();
  }, [companyId, hasBrandingParams]);

  if (loading) {
    return (
      <div className="flex items-center justify-center w-screen h-screen bg-[#020617]">
        <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div
      className={`w-screen h-screen overflow-hidden ${
        mode === "fullscreen" ? "bg-white dark:bg-[#020617]" : "bg-transparent"
      }`}
    >
      <WarrantyChat
        companyId={companyId}
        themeColor={themeColor}
        botName={botName}
        logoUrl={logoUrl || undefined}
        isWidget={true}
      />
    </div>
  );
}
