"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

const INJECT_URL = process.env.NEXT_PUBLIC_BOTPRESS_INJECT_URL || "https://cdn.botpress.cloud/webchat/v3.6/inject.js";
const CONFIG_URL = process.env.NEXT_PUBLIC_BOTPRESS_CONFIG_URL || "https://files.bpcontent.cloud/2026/02/10/12/20260210121824-S8YDKPLR.js";

export default function WidgetPage() {
  const params = useParams();
  const companyId = (params?.companyId as string) || "demo-company";

  const [themeColor, setThemeColor] = useState("#0F3B3D");
  const [botName, setBotName] = useState("AI Assistant");
  const [botLogoUrl, setBotLogoUrl] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
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
  }, [companyId]);

  useEffect(() => {
    if (loading) return;

    // Intercept Botpress initialization to customize theme and branding for the widget
    const w = window as any;
    let realBotpress: any = null;
    try {
      Object.defineProperty(w, 'botpress', {
        get: () => realBotpress,
        set: (val) => {
          if (val && val.init) {
            realBotpress = Object.create(val);
            Object.defineProperty(realBotpress, 'init', {
              value: function (options: any) {
                if (options && options.configuration) {
                  options.configuration.color = themeColor;
                  options.configuration.botName = botName;
                  if (botLogoUrl) {
                    options.configuration.avatarUrl = botLogoUrl;
                    options.configuration.botAvatar = botLogoUrl;
                    options.configuration.botAvatarUrl = botLogoUrl;
                  }
                }
                val.init.call(val, options);
              },
              writable: true,
              configurable: true,
              enumerable: true
            });
          } else {
            realBotpress = val;
          }
        },
        configurable: true,
        enumerable: true
      });
    } catch (e) {
      console.error("Failed to define botpress getter/setter:", e);
    }

    const injectScript = document.createElement("script");
    injectScript.src = INJECT_URL;
    injectScript.async = true;

    const configScript = document.createElement("script");
    configScript.src = CONFIG_URL;
    configScript.async = true;
    configScript.defer = true;

    document.body.appendChild(injectScript);
    document.body.appendChild(configScript);

    const checkBotpress = setInterval(() => {
      const bp = w.botpressWebChat || w.botpressWebchat || w.botpress;

      if (bp) {
        clearInterval(checkBotpress);

        bp.on("webchat:initialized", () => {
          if (bp.open) bp.open();

          if (bp.updateUser) {
            try {
              bp.updateUser({
                data: {
                  companyId: companyId,
                  role: "homeowner"
                },
                tags: {
                  companyId: companyId,
                  role: "homeowner"
                }
              });
            } catch (err) {
              console.error("Failed to update user in Botpress:", err);
            }
          }

          try {
            if (bp.config) {
              bp.config({
                avatarUrl: botLogoUrl,
                botAvatar: botLogoUrl,
                botAvatarUrl: botLogoUrl,
                botName: botName
              });
            }
          } catch (e) {
            console.error("Could not override botpress config", e);
          }
        });
      }
    }, 300);

    return () => {
      clearInterval(checkBotpress);
      try {
        delete w.botpress;
      } catch (e) {
        // Ignore
      }
      if (document.body.contains(injectScript)) {
        document.body.removeChild(injectScript);
      }

      const configScripts = document.querySelectorAll(`script[src="${CONFIG_URL}"]`);
      configScripts.forEach((s) => s.remove());
      const bpElements = document.querySelectorAll(
        "[id^='bp-'], [class^='bp-'], iframe[src*='botpress'], .bp-webchat-container"
      );
      bpElements.forEach((el) => {
        if (el.id !== "bp-embedded-webchat") {
          el.remove();
        }
      });
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
