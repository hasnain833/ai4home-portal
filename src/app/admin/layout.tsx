"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "next-themes";
import { motion, AnimatePresence } from "framer-motion";
import {
  LayoutDashboard,
  Building2,
  Users,
  LogOut,
  Sun,
  Moon,
  ChevronLeft,
  ChevronRight,
  Menu,
  X,
  ShieldAlert,
  Loader2
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";

const adminNavItems = [
  { name: "Overview", href: "/admin", icon: LayoutDashboard },
  { name: "Companies", href: "/admin/companies", icon: Building2 },
  { name: "Users & Access", href: "/admin/users", icon: Users },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const [sidebarExpanded, setSidebarExpanded] = useState(true);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const pathname = usePathname();
  const router = useRouter();
  const { user, logout, isLoading } = useAuth();
  const { theme, setTheme } = useTheme();

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!isLoading && mounted) {
      if (!user) {
        router.push("/login");
      } else if (!user.isSuperAdmin) {
        router.push("/");
      }
    }
  }, [user, isLoading, mounted, router]);

  const toggleSidebar = () => setSidebarExpanded(!sidebarExpanded);
  const closeMobileSidebar = () => setMobileSidebarOpen(false);

  const sidebarWidth = sidebarExpanded ? 256 : 80;

  if (!mounted || isLoading) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-slate-50 dark:bg-slate-950">
        <Loader2 className="h-8 w-8 animate-spin text-[#c59b4c]" />
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-slate-50 dark:bg-slate-950 overflow-hidden">
      {/* Desktop Sidebar */}
      <motion.aside
        initial={false}
        animate={{ width: sidebarWidth }}
        transition={{ duration: 0.2, ease: "easeInOut" }}
        className="fixed inset-y-0 left-0 z-50 hidden md:block bg-[#04060a] text-zinc-100 shadow-2xl border-r border-white/5"
      >
        <div className="flex h-full flex-col">
          {/* Header */}
          <div className="flex h-16 items-center justify-between px-4 mt-2">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#c59b4c]/10 border border-[#c59b4c]/20 text-[#c59b4c]">
                <ShieldAlert className="h-5 w-5" />
              </div>
              {sidebarExpanded && (
                <span className="text-lg font-bold tracking-tight font-serif text-white">Super Admin</span>
              )}
            </div>
            <Button variant="ghost" size="icon" onClick={toggleSidebar} className="text-zinc-400 hover:text-white hover:bg-white/5">
              {sidebarExpanded ? <ChevronLeft className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            </Button>
          </div>
          
          <div className="px-4 py-2">
            <Separator className="bg-white/10" />
          </div>

          {/* Navigation */}
          <nav className="flex-1 space-y-2 p-3 overflow-y-auto">
            {adminNavItems.map((item) => {
              const isActive = pathname === item.href;
              return (
                <Link key={item.name} href={item.href}>
                  <motion.div
                    whileHover={{ x: 4 }}
                    transition={{ duration: 0.2 }}
                    className={`flex items-center space-x-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all ${
                      isActive
                        ? "bg-[#c59b4c]/10 border border-[#c59b4c]/20 text-[#c59b4c]"
                        : "text-zinc-400 hover:bg-white/5 hover:text-zinc-200 border border-transparent"
                    }`}
                  >
                    <item.icon className={`h-5 w-5 shrink-0 ${isActive ? "text-[#c59b4c]" : ""}`} />
                    {sidebarExpanded && <span>{item.name}</span>}
                  </motion.div>
                </Link>
              );
            })}
          </nav>

          {/* Footer */}
          <div className="border-t border-white/10 p-4 space-y-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              className="w-full justify-start text-zinc-400 hover:bg-white/5 hover:text-zinc-200"
            >
              {theme === "dark" ? <Sun className="h-4 w-4 mr-3" /> : <Moon className="h-4 w-4 mr-3" />}
              {sidebarExpanded && (theme === "dark" ? "Light Mode" : "Dark Mode")}
            </Button>

            <div className="w-full flex items-center justify-between gap-3 rounded-xl bg-white/5 border border-white/5 px-3 py-2.5 text-sm transition-all">
              <div className="flex items-center gap-3 overflow-hidden">
                <div className="h-8 w-8 rounded-full bg-zinc-800 flex items-center justify-center shrink-0 border border-white/10">
                  <span className="text-xs font-bold text-zinc-300">SA</span>
                </div>
                {sidebarExpanded && (
                  <div className="flex-1 text-left overflow-hidden">
                    <p className="text-xs font-semibold text-zinc-200 truncate">
                      {user?.name || "System Admin"}
                    </p>
                    <p className="text-[10px] text-[#c59b4c] uppercase tracking-wider">Root Access</p>
                  </div>
                )}
              </div>
              {sidebarExpanded && (
                <Button variant="ghost" size="icon" onClick={logout} className="h-8 w-8 text-zinc-400 hover:text-red-400 hover:bg-red-500/10 shrink-0" title="Logout">
                  <LogOut className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>
        </div>
      </motion.aside>

      {/* Main Content Wrapper */}
      <main className={`flex-1 flex flex-col transition-all duration-200 ease-in-out h-full overflow-hidden ${sidebarExpanded ? "md:ml-64" : "md:ml-20"}`}>
        {/* Mobile Header */}
        <header className="sticky top-0 z-40 flex h-16 items-center justify-between border-b border-slate-200 dark:border-slate-800 bg-white/80 dark:bg-slate-900/80 backdrop-blur-md px-4 md:hidden">
          <Button variant="ghost" size="icon" onClick={() => setMobileSidebarOpen(true)}>
            <Menu className="h-5 w-5" />
          </Button>
          <div className="flex items-center gap-2">
            <ShieldAlert className="h-5 w-5 text-[#c59b4c]" />
            <span className="font-bold font-serif">Super Admin</span>
          </div>
          <div className="w-9" /> {/* Spacer */}
        </header>

        {/* Mobile Sidebar */}
        <AnimatePresence>
          {mobileSidebarOpen && (
            <>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm md:hidden"
                onClick={closeMobileSidebar}
              />
              <motion.aside
                initial={{ x: "-100%" }}
                animate={{ x: 0 }}
                exit={{ x: "-100%" }}
                transition={{ type: "spring", damping: 25, stiffness: 200 }}
                className="fixed top-0 left-0 z-50 h-full w-72 bg-[#04060a] text-zinc-100 shadow-2xl md:hidden"
              >
                <div className="flex h-full flex-col">
                  <div className="flex h-16 items-center justify-between px-4 mt-2">
                    <div className="flex items-center gap-3">
                      <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#c59b4c]/10 border border-[#c59b4c]/20 text-[#c59b4c]">
                        <ShieldAlert className="h-5 w-5" />
                      </div>
                      <span className="text-lg font-bold tracking-tight font-serif text-white">Super Admin</span>
                    </div>
                    <Button variant="ghost" size="icon" onClick={closeMobileSidebar} className="text-zinc-400 hover:text-white">
                      <X className="h-5 w-5" />
                    </Button>
                  </div>
                  
                  <div className="px-4 py-2">
                    <Separator className="bg-white/10" />
                  </div>

                  <nav className="flex-1 space-y-2 p-3">
                    {adminNavItems.map((item) => {
                      const isActive = pathname === item.href;
                      return (
                        <Link key={item.name} href={item.href} onClick={closeMobileSidebar}>
                          <div className={`flex items-center space-x-3 rounded-xl px-3 py-3 text-sm font-medium transition-all ${
                            isActive
                              ? "bg-[#c59b4c]/10 border border-[#c59b4c]/20 text-[#c59b4c]"
                              : "text-zinc-400 hover:bg-white/5 hover:text-zinc-200"
                          }`}>
                            <item.icon className="h-5 w-5 shrink-0" />
                            <span>{item.name}</span>
                          </div>
                        </Link>
                      );
                    })}
                  </nav>

                  <div className="border-t border-white/10 p-4 space-y-3">
                    <Button
                      variant="ghost"
                      onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
                      className="w-full justify-start text-zinc-400 hover:bg-white/5"
                    >
                      {theme === "dark" ? <Sun className="h-4 w-4 mr-3" /> : <Moon className="h-4 w-4 mr-3" />}
                      {theme === "dark" ? "Light Mode" : "Dark Mode"}
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={logout}
                      className="w-full justify-start text-zinc-400 hover:text-red-400 hover:bg-red-500/10"
                    >
                      <LogOut className="h-4 w-4 mr-3" />
                      Logout
                    </Button>
                  </div>
                </div>
              </motion.aside>
            </>
          )}
        </AnimatePresence>

        {/* Page Content */}
        <div className="flex-1 overflow-auto p-4 md:p-8">
          <div className="mx-auto max-w-7xl h-full">
            {children}
          </div>
        </div>
      </main>
    </div>
  );
}
