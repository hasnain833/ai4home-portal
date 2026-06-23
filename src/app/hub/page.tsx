"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Bot, Layers, Sun, Moon, LogOut, CheckCircle2, Lock } from "lucide-react";
import { motion } from "framer-motion";

export default function HubPage() {
  const { user, logout, isLoading } = useAuth();
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!isLoading && !user) {
      router.push("/login");
    }
  }, [user, isLoading, router]);

  if (!mounted || isLoading || !user) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-50 dark:bg-slate-950">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#b48c3c]"></div>
      </div>
    );
  }

  const handleSelectWorkspace = (workspace: "warranty" | "sales") => {
    // Save selection in memory (both localStorage and cookies for middleware accessibility)
    localStorage.setItem("last-workspace", workspace);
    document.cookie = `last-workspace=${workspace}; path=/; max-age=31536000; SameSite=Lax`;

    // Redirect to the workspace dashboard
    router.push(`/${workspace}/dashboard`);
  };

  const getInitials = (name: string) =>
    name.split(" ").map((n) => n[0]).join("").toUpperCase();

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex flex-col justify-between py-12 px-4 sm:px-6 lg:px-8 transition-colors duration-300">

      {/* Top Header */}
      <header className="max-w-5xl mx-auto w-full flex justify-between items-center">
        <div className="flex items-center gap-3">
          <img src={user.companyLogo || "/logo.png"} alt="Logo" className="h-9 w-auto object-contain rounded-md" />
          <span className="text-xl font-bold tracking-tight text-[#0F3B3D] dark:text-[#a0c5c7]">
            {user.companyName || "Aiforhomebuilder"}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            className="text-slate-500 hover:bg-slate-200/50 dark:hover:bg-slate-900/50"
          >
            {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={logout}
            className="text-slate-500 hover:bg-slate-200/50 dark:hover:bg-slate-900/50 gap-1.5 h-9"
          >
            <LogOut className="h-4 w-4" />
            Logout
          </Button>
        </div>
      </header>

      {/* Main Selection Area */}
      <main className="max-w-3xl mx-auto w-full my-auto py-8 text-center">
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="space-y-3"
        >
          <h2 className="text-3xl font-extrabold text-slate-900 dark:text-white tracking-tight sm:text-4xl">
            Welcome back, {user.name}
          </h2>
          <p className="text-slate-500 dark:text-slate-400 max-w-lg mx-auto text-sm sm:text-base">
            Please choose a workspace to continue. Your workspace selection determines your current dashboard views and workflows.
          </p>
        </motion.div>

        {/* Workspace Cards Grid */}
        <motion.div
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.15 }}
          className="mt-12 grid gap-6 grid-cols-1 sm:grid-cols-2"
        >
          {/* Warranty Workspace Card */}
          <Card
            onClick={() => user.hasWarrantyAccess && handleSelectWorkspace("warranty")}
            className={`group text-left border relative overflow-hidden transition-all duration-300 cursor-pointer flex flex-col justify-between ${user.hasWarrantyAccess
                ? "hover:shadow-xl hover:border-[#0F3B3D]/50 border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/50"
                : "opacity-60 bg-slate-100/50 dark:bg-slate-950/20 border-dashed cursor-not-allowed"
              }`}
          >
            <div className="absolute right-0 top-0 translate-x-4 -translate-y-4 opacity-5 group-hover:opacity-10 transition pointer-events-none">
              <Bot className="h-32 w-32" />
            </div>
            <CardHeader className="p-6 pb-2">
              <div className="flex justify-between items-start">
                <div className="bg-[#0F3B3D]/10 dark:bg-[#0F3B3D]/20 text-[#0F3B3D] dark:text-[#a0c5c7] p-3 rounded-xl">
                  <Bot className="h-6 w-6" />
                </div>
                {!user.hasWarrantyAccess ? (
                  <Badge variant="outline" className="border-slate-300 text-slate-500 gap-1 py-0.5">
                    <Lock className="h-3 w-3" /> Locked
                  </Badge>
                ) : (
                  <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-400 hover:bg-emerald-100 gap-1">
                    <CheckCircle2 className="h-3 w-3" /> Entitled
                  </Badge>
                )}
              </div>
              <CardTitle className="text-xl font-bold text-slate-900 dark:text-white mt-4">
                Warranty Care
              </CardTitle>
              <CardDescription className="text-slate-500 dark:text-slate-400 mt-2 text-sm leading-relaxed">
                Handle builder homeowner claims, check property COE closing dates, analyze DIY guides, and manage support agent configurations.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-6 pt-4 border-t border-slate-100 dark:border-slate-800/60 mt-auto bg-slate-50/50 dark:bg-slate-950/10">
              <Button
                disabled={!user.hasWarrantyAccess}
                className="w-full bg-[#0F3B3D] hover:bg-[#0F3B3D]/90 text-white font-semibold cursor-pointer border-none"
              >
                Launch Workspace
              </Button>
            </CardContent>
          </Card>

          {/* Sales Workspace Card */}
          <Card
            onClick={() => user.hasSalesAccess && handleSelectWorkspace("sales")}
            className={`group text-left border relative overflow-hidden transition-all duration-300 cursor-pointer flex flex-col justify-between ${user.hasSalesAccess
                ? "hover:shadow-xl hover:border-[#b48c3c]/50 border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/50"
                : "opacity-60 bg-slate-100/50 dark:bg-slate-950/20 border-dashed cursor-not-allowed"
              }`}
          >
            <div className="absolute right-0 top-0 translate-x-4 -translate-y-4 opacity-5 group-hover:opacity-10 transition pointer-events-none">
              <Layers className="h-32 w-32" />
            </div>
            <CardHeader className="p-6 pb-2">
              <div className="flex justify-between items-start">
                <div className="bg-[#b48c3c]/10 dark:bg-[#b48c3c]/20 text-[#b48c3c] p-3 rounded-xl">
                  <Layers className="h-6 w-6" />
                </div>
                {!user.hasSalesAccess ? (
                  <Badge variant="outline" className="border-slate-300 text-slate-500 gap-1 py-0.5">
                    <Lock className="h-3 w-3" /> Locked
                  </Badge>
                ) : (
                  <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-400 hover:bg-emerald-100 gap-1">
                    <CheckCircle2 className="h-3 w-3" /> Entitled
                  </Badge>
                )}
              </div>
              <CardTitle className="text-xl font-bold text-slate-900 dark:text-white mt-4">
                Sales Hub
              </CardTitle>
              <CardDescription className="text-slate-500 dark:text-slate-400 mt-2 text-sm leading-relaxed">
                Connect CRM systems, parse CSV files, initiate automated email/SMS campaigns, review scheduled events, and draft AI blog posts.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-6 pt-4 border-t border-slate-100 dark:border-slate-800/60 mt-auto bg-slate-50/50 dark:bg-slate-950/10">
              <Button
                disabled={!user.hasSalesAccess}
                className="w-full bg-[#b48c3c] hover:bg-[#b48c3c]/90 text-white font-semibold cursor-pointer border-none"
              >
                Launch Workspace
              </Button>
            </CardContent>
          </Card>
        </motion.div>
      </main>

      {/* Footer */}
      <footer className="max-w-5xl mx-auto w-full text-center text-xs text-slate-400 dark:text-slate-600 border-t border-slate-200/50 dark:border-slate-800/50 pt-6">
        © {new Date().getFullYear()} Aiforhomebuilder. All rights reserved. Confidential Portal.
      </footer>
    </div>
  );
}
