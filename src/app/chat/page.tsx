"use client";

import { useState, useEffect } from "react";
import PortalLayout from "@/components/layout/PortalLayout";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Bot, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function AIChatPage() {
  const [botId, setBotId] = useState<string>("");

  useEffect(() => {
    // Load Bot ID from environment or system setting
    const id = process.env.NEXT_PUBLIC_BOTPRESS_BOT_ID || "3c8bb03b-e01e-450a-bc95-8d591ff1b5e3";
    setBotId(id);

    // Dynamic injection of Botpress floating Webchat scripts so the webchat works natively!
    const injectScript = document.createElement("script");
    injectScript.src = "https://cdn.botpress.cloud/webchat/v2.2/inject.js";
    injectScript.async = true;
    document.body.appendChild(injectScript);

    const configScript = document.createElement("script");
    configScript.src = `https://mediafiles.botpress.cloud/${id}/webchat/v2.2/config.js`;
    configScript.async = true;
    configScript.defer = true;
    document.body.appendChild(configScript);

    return () => {
      // Cleanup scripts on unmount
      if (document.body.contains(injectScript)) {
        document.body.removeChild(injectScript);
      }
      if (document.body.contains(configScript)) {
        document.body.removeChild(configScript);
      }
      // Also clean up any DOM components the Botpress script might have created
      const webchatIframe = document.getElementById("bp-webchat-container") || document.querySelector("iframe[src*='botpress']");
      if (webchatIframe) {
        webchatIframe.remove();
      }
    };
  }, []);

  return (
    <ProtectedRoute allowedRoles={["admin", "staff", "homeowner"]}>
      <PortalLayout>
        <div className="flex flex-col h-[calc(100vh-120px)] max-w-5xl mx-auto px-4">
          <Card className="flex-1 flex flex-col overflow-hidden shadow-2xl border border-gray-100 rounded-3xl bg-white/85 backdrop-blur-md">
            <CardHeader className="border-b bg-[#0F3B3D]/5 py-4 px-6 flex flex-row items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="bg-[#0F3B3D]/10 p-2.5 rounded-2xl">
                  <Bot className="h-6 w-6 text-[#0F3B3D]" />
                </div>
                <div>
                  <CardTitle className="text-xl font-bold text-[#0F3B3D]">Warranty Support AI</CardTitle>
                  <p className="text-xs text-[#0F3B3D]/70 flex items-center gap-1.5 mt-0.5">
                    <span className="h-2.5 w-2.5 rounded-full bg-green-500 animate-pulse border-2 border-white shadow-sm"></span>
                    Botpress Agent Active
                  </p>
                </div>
              </div>
              <Button 
                variant="outline" 
                size="icon" 
                onClick={() => window.location.reload()} 
                className="h-9 w-9 rounded-xl border-gray-200 hover:bg-[#0F3B3D]/10 text-gray-700 transition-colors"
                title="Restart Chat"
              >
                <RefreshCw className="h-4 w-4" />
              </Button>
            </CardHeader>
            
            <CardContent className="flex-1 p-0 overflow-hidden relative min-h-[500px]">
              {botId ? (
                <iframe
                  src={`https://cdn.botpress.cloud/webchat/v2.2/shareable.html?botId=${botId}`}
                  className="w-full h-full border-0 bg-gray-50"
                  title="Botpress Webchat"
                  allow="microphone; camera"
                />
              ) : (
                <div className="flex flex-col items-center justify-center h-full p-8 text-center text-gray-500">
                  <div className="bg-gray-100 p-4 rounded-full mb-3 animate-pulse">
                    <Bot className="h-8 w-8 text-gray-400" />
                  </div>
                  <p className="text-sm font-semibold">Initializing Botpress...</p>
                  <p className="text-xs text-gray-400 mt-1">Please ensure NEXT_PUBLIC_BOTPRESS_BOT_ID is set in your .env</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </PortalLayout>
    </ProtectedRoute>
  );
}

