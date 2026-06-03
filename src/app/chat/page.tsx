"use client";

import { useEffect, useState } from "react";
import PortalLayout from "@/components/layout/PortalLayout";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { useAuth } from "@/contexts/AuthContext";
import { Bot, Copy, Check, Info, Code } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

const INJECT_URL = process.env.NEXT_PUBLIC_BOTPRESS_INJECT_URL || "https://cdn.botpress.cloud/webchat/v3.6/inject.js";
const CONFIG_URL = process.env.NEXT_PUBLIC_BOTPRESS_CONFIG_URL || "https://files.bpcontent.cloud/2026/02/10/12/20260210121824-S8YDKPLR.js";

export default function AIChatPage() {
  const { user, isLoading } = useAuth();
  const [copied, setCopied] = useState(false);
  const [themeColor, setThemeColor] = useState("#0F3B3D");

  const botName = user?.companyName ? `${user.companyName} Assistant` : "Ai.Lumen Assistant";
  const botLogoUrl = user?.companyLogo || (typeof window !== "undefined" ? window.location.origin + "/logo.png" : "");

  useEffect(() => {
    if (isLoading || !user) return;

    const fetchCompanyData = async () => {
      try {
        const response = await fetch("/api/company");
        if (response.ok) {
          const data = await response.json();
          if (data && data.botColor) {
            setThemeColor(data.botColor);
          }
        }
      } catch (error) {
        console.error("Failed to fetch company details:", error);
      }
    };
    fetchCompanyData();
  }, [user, isLoading]);

  useEffect(() => {
    // Wait until the user data is fully loaded before initializing the chat
    if (isLoading || !user) return;

    // Intercept Botpress initialization to customize theme and branding for the preview bot
    const w = window as any;
    let realBotpress: any = null;
    try {
      Object.defineProperty(w, 'botpress', {
        get: () => realBotpress,
        set: (val) => {
          if (val && val.init) {
            // Create a wrapper object that inherits from original to override read-only init function
            realBotpress = Object.create(val);
            Object.defineProperty(realBotpress, 'init', {
              value: function (options: any) {
                if (options && options.configuration) {
                  options.configuration.color = themeColor;
                  options.configuration.botName = botName;
                  options.configuration.avatarUrl = botLogoUrl;
                  options.configuration.botAvatar = botLogoUrl;
                  options.configuration.botAvatarUrl = botLogoUrl;
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
      const bp = (window as any).botpressWebChat || (window as any).botpressWebchat || (window as any).botpress;

      if (bp) {
        clearInterval(checkBotpress);

        bp.on("webchat:initialized", () => {
          if (bp.open) bp.open();

          if (user && bp.updateUser) {
            try {
              bp.updateUser({
                data: {
                  email: user.email || "",
                  externalId: user.id || "",
                  name: user.name || "",
                  role: user.role || "",
                  companyId: user.companyId || "",
                  companyName: user.companyName || ""
                },
                tags: {
                  email: user.email || "",
                  userId: user.id || "",
                  name: user.name || "",
                  role: user.role || "",
                  companyId: user.companyId || "",
                  companyName: user.companyName || ""
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
        delete (window as any).botpress;
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
  }, [user, isLoading, themeColor, botName, botLogoUrl]);

  const portalUrl = process.env.NEXT_PUBLIC_URL || (typeof window !== "undefined" ? window.location.origin : "http://localhost:3000");

  const embedScriptCode = `<div id="bp-embedded-webchat" style="width: 100%; height: 600px; border-radius: 12px; overflow: hidden; border: 1px solid #1e293b;"></div>
<script>
  (function() {
    var realBotpress = null;
    Object.defineProperty(window, 'botpress', {
      get: function() {
        return realBotpress;
      },
      set: function(val) {
        if (val && val.init) {
          realBotpress = Object.create(val);
          Object.defineProperty(realBotpress, 'init', {
            value: function(options) {
              fetch("${portalUrl}/api/company/branding?id=${user?.companyId || "demo-company"}")
                .then(function(res) { return res.json(); })
                .then(function(data) {
                  if (options && options.configuration) {
                    options.configuration.color = data.botColor || "${themeColor}";
                    options.configuration.botName = data.name ? (data.name + " Assistant") : "${botName}";
                    var logo = data.logo || "${botLogoUrl}";
                    options.configuration.avatarUrl = logo;
                    options.configuration.botAvatar = logo;
                    options.configuration.botAvatarUrl = logo;
                  }
                  val.init.call(val, options);
                })
                .catch(function(err) {
                  if (options && options.configuration) {
                    options.configuration.color = "${themeColor}";
                    options.configuration.botName = "${botName}";
                    options.configuration.avatarUrl = "${botLogoUrl}";
                    options.configuration.botAvatar = "${botLogoUrl}";
                    options.configuration.botAvatarUrl = "${botLogoUrl}";
                  }
                  val.init.call(val, options);
                });
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
  })();
</script>
<script src="${INJECT_URL}"></script>
<script src="${CONFIG_URL}" defer></script>
<script>
  window.addEventListener('load', function() {
    var checkBotpress = setInterval(function() {
      var bp = window.botpressWebChat || window.botpressWebchat || window.botpress;
      if (bp) {

        clearInterval(checkBotpress);
        bp.on("webchat:initialized", function() {
          if (bp.open) bp.open();
          if (bp.updateUser) {
            try {
              bp.updateUser({
                data: {
                  companyId: "${user?.companyId || ""}",
                  role: "homeowner"
                },
                tags: {
                  companyId: "${user?.companyId || ""}",
                  role: "homeowner"
                }
              });
            } catch (err) {
              console.error("Failed to update user in Botpress:", err);
            }
          }
        });
      }
    }, 300);
  });
</script>`;


  const copyToClipboard = () => {
    navigator.clipboard.writeText(embedScriptCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <ProtectedRoute allowedRoles={["admin", "staff", "homeowner"]}>
      <PortalLayout>
        <div className="flex flex-col h-[calc(100vh-120px)] max-w-4xl mx-auto px-2 sm:px-4 w-full gap-4 pb-4">
          <div className="flex flex-row items-center justify-between gap-4 shrink-0">
            <div>
              <h1 className="text-2xl md:text-3xl font-bold flex items-center gap-3">
                <Bot className="h-7 w-7 md:h-8 md:w-8 text-[#0F3B3D] dark:text-[#b48c3c]" />
                <span className="bg-linear-to-r from-primary to-primary/60 bg-clip-text text-transparent dark:from-[#b48c3c] dark:to-[#d4af6c]">
                  AI Assistant
                </span>
              </h1>
            </div>

            {(user?.role === "admin" || user?.role === "staff") && (
              <Dialog>
                <DialogTrigger asChild>
                  <Button className="gap-2 bg-[#0F3B3D] hover:bg-[#0F3B3D]/90 text-white font-medium" size="sm">
                    <Code className="h-4 w-4" />
                    Embed Widget
                  </Button>
                </DialogTrigger>
                <DialogContent className="sm:max-w-2xl bg-card border border-border shadow-xl w-full overflow-hidden">
                  <DialogHeader className="border-b border-border/50 pb-4">
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-xl bg-[#0F3B3D]/10 dark:bg-[#b48c3c]/10 text-primary dark:text-[#b48c3c]">
                        <Bot className="h-6 w-6" />
                      </div>
                      <div>
                        <DialogTitle className="text-lg">AI Assistant Widget Embed</DialogTitle>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Integrate this AI assistant into your company's website.
                        </p>
                      </div>
                    </div>
                  </DialogHeader>
                  <div className="pt-4 space-y-4 w-full overflow-hidden">
                    {/* Color Customizer */}
                    <div className="bg-[#0F3B3D]/5 dark:bg-[#b48c3c]/5 border border-border/50 rounded-xl p-4 space-y-3">
                      <div className="flex flex-col gap-0.5">
                        <span className="text-xs font-semibold text-foreground">Chatbot Theme Color</span>
                        <span className="text-[10px] text-muted-foreground">Select a custom color matching your company's branding color scheme.</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <input
                          type="color"
                          value={themeColor}
                          onChange={async (e) => {
                            const newColor = e.target.value;
                            setThemeColor(newColor);
                            try {
                              await fetch("/api/company", {
                                method: "PUT",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ botColor: newColor })
                              });
                            } catch (err) {
                              console.error("Failed to save bot color:", err);
                            }
                          }}
                          className="h-9 w-9 cursor-pointer rounded-lg border border-border bg-transparent p-0 overflow-hidden shrink-0"
                        />
                        <div className="flex flex-col">
                          <span className="text-xs font-mono font-bold uppercase tracking-wider text-foreground">{themeColor}</span>
                          <span className="text-[9px] text-muted-foreground uppercase font-semibold">HEX Color Value</span>
                        </div>
                      </div>
                    </div>

                    <div className="flex justify-between items-center">
                      <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Widget Code</span>
                      <Button
                        onClick={copyToClipboard}
                        className="gap-2 bg-[#0F3B3D] hover:bg-[#0F3B3D]/90 text-white font-medium"
                        size="sm"
                      >
                        {copied ? (
                          <>
                            <Check className="h-4 w-4 text-green-400" />
                            Copied!
                          </>
                        ) : (
                          <>
                            <Copy className="h-4 w-4" />
                            Copy Script
                          </>
                        )}
                      </Button>
                    </div>
                    <div className="relative rounded-xl border border-slate-800 bg-[#020617] p-4 text-xs font-mono text-slate-300 overflow-x-auto max-h-[200px] w-full">
                      <pre className="whitespace-pre">{embedScriptCode}</pre>
                    </div>
                    <div className="bg-[#0F3B3D]/5 dark:bg-[#b48c3c]/5 border border-[#0F3B3D]/25 dark:border-[#b48c3c]/25 rounded-xl p-4 flex items-start gap-3 w-full">
                      <Info className="h-5 w-5 text-[#0F3B3D] dark:text-[#b48c3c] shrink-0 mt-0.5" />
                      <div className="text-xs text-muted-foreground space-y-1">
                        <p className="font-semibold text-foreground">💡 How to use this script:</p>
                        <p>1. Copy the script code block above.</p>
                        <p>2. Paste the snippet into the HTML of your external website (preferably right before the closing <code className="px-1 py-0.5 rounded bg-muted font-mono">&lt;/body&gt;</code> tag).</p>
                        <p>3. The script dynamically binds the assistant to a container element with ID <code className="px-1 py-0.5 rounded bg-muted font-mono">bp-embedded-webchat</code> and passes your builder's unique ID (<code className="px-1 py-0.5 rounded bg-muted font-mono">{user?.companyId || "demo-company"}</code>) to ensure proper scoping.</p>
                      </div>
                    </div>
                  </div>

                </DialogContent>
              </Dialog>
            )}
          </div>

          <div className="flex-1 w-full overflow-hidden rounded-3xl border border-slate-800 shadow-2xl bg-[#020617] p-0 flex flex-col min-h-0">
            <div
              id="bp-embedded-webchat"
              className="w-full h-full bg-[#020617]"
            />
          </div>
        </div>
      </PortalLayout>
    </ProtectedRoute>
  );
}



