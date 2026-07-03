"use client";

import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";

const INJECT_URL = process.env.NEXT_PUBLIC_BOTPRESS_INJECT_URL || "https://cdn.botpress.cloud/webchat/v3.6/inject.js";
const CONFIG_URL = process.env.NEXT_PUBLIC_BOTPRESS_CONFIG_URL || "https://files.bpcontent.cloud/2026/06/24/12/20260624123527-XY5YMA41.js";

export default function WidgetPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const companyId = (params?.companyId as string) || "demo-company";

  // Read branding from query params first (passed by widget.js), fallback to API
  const qColor = searchParams.get("botColor");
  const qName = searchParams.get("botName");
  const qLogo = searchParams.get("botLogo");

  const hasBrandingParams = !!(qColor || qName || qLogo);

  const [themeColor, setThemeColor] = useState(qColor || "#0F3B3D");
  const [botName, setBotName] = useState(qName || "AI Assistant");
  const [botLogoUrl, setBotLogoUrl] = useState(qLogo || "");
  const [loading, setLoading] = useState(!hasBrandingParams); // Skip loading if params already present

  // Only fetch branding from API if no query params were provided (direct iframe access)
  useEffect(() => {
    if (hasBrandingParams) return; // Already have branding from query params

    const fetchBranding = async () => {
      try {
        const response = await fetch(`/api/company/branding?id=${companyId}`);
        if (response.ok) {
          const data = await response.json();
          if (data) {
            if (data.botColor) setThemeColor(data.botColor);
            if (data.name) setBotName(`${data.name} Assistant`);
            if (data.logo) setBotLogoUrl(data.logo);
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

  // Preload Botpress CDN scripts as soon as component mounts
  useEffect(() => {
    const preloadInject = document.createElement("link");
    preloadInject.rel = "preload";
    preloadInject.href = INJECT_URL;
    preloadInject.as = "script";
    document.head.appendChild(preloadInject);

    const preloadConfig = document.createElement("link");
    preloadConfig.rel = "preload";
    preloadConfig.href = CONFIG_URL;
    preloadConfig.as = "script";
    document.head.appendChild(preloadConfig);

    return () => {
      if (document.head.contains(preloadInject)) document.head.removeChild(preloadInject);
      if (document.head.contains(preloadConfig)) document.head.removeChild(preloadConfig);
    };
  }, []);

  useEffect(() => {
    if (loading) return;

    let cancelled = false;

    // Load inject.js, then a same-origin /bp-config script with per-company branding
    // + embeddedChatId baked in. We DON'T proxy window.botpress — that breaks
    // Botpress' inline (embedded) mount and forces the floating widget.
    const injectScript = document.createElement("script");
    injectScript.src = INJECT_URL;
    injectScript.async = true;

    const params = new URLSearchParams({ botColor: themeColor, botName });
    if (botLogoUrl) params.set("botLogo", botLogoUrl);
    const configScript = document.createElement("script");
    configScript.src = `/bp-config?${params.toString()}`;
    configScript.defer = true;

    const startWebchat = () => {
      if (cancelled) return;
      const bp = (window as any).botpress;
      if (!bp) {
        setTimeout(startWebchat, 100);
        return;
      }

      // Register listeners BEFORE the config script calls botpress.init(...).
      try {
        bp.on("webchat:initialized", () => {
          if (bp.updateUser) {
            try {
              bp.updateUser({
                data: { companyId, role: "homeowner" },
                tags: { companyId, role: "homeowner" },
              });
            } catch (err) {
              console.error("Failed to update user in Botpress:", err);
            }
          }
        });
      } catch (err) {
        console.error("Failed to register Botpress listener:", err);
      }

      document.body.appendChild(configScript);
    };

    injectScript.onload = startWebchat;
    document.body.appendChild(injectScript);

    return () => {
      cancelled = true;
      if (document.body.contains(injectScript)) document.body.removeChild(injectScript);
      if (document.body.contains(configScript)) document.body.removeChild(configScript);
      const bpElements = document.querySelectorAll(
        "[class^='bp-'], iframe[src*='botpress'], .bp-webchat-container"
      );
      bpElements.forEach((el) => el.remove());
      try {
        delete (window as any).botpress;
      } catch {
        // Ignore — inject.js may define it as non-configurable.
      }
    };
  }, [loading, companyId, themeColor, botName, botLogoUrl]);

  if (loading) {
    return (
      <div className="flex items-center justify-center w-screen h-screen bg-[#020617]">
        <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div className="w-screen h-screen overflow-hidden bg-transparent">
      {/* Botpress embedded container */}
      <div
        id="bp-embedded-webchat"
        className="w-full h-full bg-transparent"
      />
    </div>
  );
}
