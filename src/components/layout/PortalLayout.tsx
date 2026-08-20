"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "next-themes";
import { motion, AnimatePresence } from "framer-motion";
import {
  LayoutDashboard,
  Ticket,
  Plug,
  Bot,
  Database,
  Building2,
  BarChart3,
  Menu,
  LogOut,
  User,
  Sun,
  Moon,
  ChevronDown,
  PanelLeftClose,
  PanelLeftOpen,
  X,
  Users,
  Pencil,
  Activity,
  Check,
  Layers,
  CalendarDays,
  CalendarClock,
  Settings,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import VerificationGate from "@/components/layout/VerificationGate";
import { BrandLogo } from "@/components/BrandLogo";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Circle } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { SALES_PERMISSION, hasSalesPermission, type SalesPermission } from "@/lib/sales-permissions";

type NavItem = {
  name: string;
  href: string;
  icon: LucideIcon;
  roles: string[];
  permission?: SalesPermission;
};

const warrantyNavItems: NavItem[] = [
  { name: "Dashboard", href: "/warranty/dashboard", icon: LayoutDashboard, roles: ["admin", "staff", "homeowner"] },
  { name: "AI Assistant", href: "/warranty/chat", icon: Bot, roles: ["admin", "staff", "homeowner"] },
  { name: "Properties", href: "/warranty/properties", icon: Building2, roles: ["admin", "staff", "homeowner"] },
  { name: "Tickets", href: "/warranty/tickets", icon: Ticket, roles: ["admin", "staff", "homeowner"] },
  { name: "Team", href: "/warranty/team", icon: Users, roles: ["admin"] },
  { name: "Homeowners", href: "/warranty/homeowners", icon: User, roles: ["admin", "staff"] },
  { name: "Integrations", href: "/warranty/integrations", icon: Plug, roles: ["admin"] },
  { name: "Knowledge Base", href: "/warranty/knowledge-base", icon: Database, roles: ["admin", "staff"] },
  { name: "Company", href: "/warranty/company", icon: Building2, roles: ["admin", "staff"] },
  { name: "Reports", href: "/warranty/reports", icon: BarChart3, roles: ["admin", "staff"] },
  { name: "Profile", href: "/warranty/profile", icon: User, roles: ["staff", "homeowner"] },
];

const salesNavItems: NavItem[] = [
  { name: "Dashboard", href: "/sales/dashboard", icon: LayoutDashboard, roles: ["admin", "staff", "homeowner"] },
  { name: "Leads", href: "/sales/leads", icon: Users, roles: ["admin", "staff", "homeowner"] },
  { name: "Campaigns", href: "/sales/campaigns", icon: Layers, roles: ["admin", "staff"], permission: SALES_PERMISSION.campaignsManage },
  { name: "Content Calendar", href: "/sales/calendar", icon: CalendarDays, roles: ["admin", "staff", "homeowner"] },
  { name: "Appointments", href: "/sales/scheduling", icon: CalendarClock, roles: ["admin", "staff"] },
  { name: "Announcements", href: "/sales/announcements", icon: Bot, roles: ["admin", "staff"], permission: SALES_PERMISSION.announcementsPublish },
  { name: "News Feed", href: "/sales/news", icon: Activity, roles: ["admin", "staff", "homeowner"] },
  { name: "Blog Posts", href: "/sales/blog", icon: Pencil, roles: ["admin", "staff"], permission: SALES_PERMISSION.blogManage },
  { name: "Knowledge Base", href: "/sales/knowledge-base", icon: Database, roles: ["admin", "staff"], permission: SALES_PERMISSION.kbManage },
  { name: "Automations", href: "/sales/automations", icon: Plug, roles: ["admin", "staff"], permission: SALES_PERMISSION.automationsManage },
  { name: "Settings", href: "/sales/settings", icon: Settings, roles: ["admin", "staff"], permission: SALES_PERMISSION.settingsManage },
];

export default function PortalLayout({
  children,
  workspace = "warranty",
}: {
  children: React.ReactNode;
  workspace?: "warranty" | "sales";
}) {
  const [sidebarExpanded, setSidebarExpanded] = useState(() => {
    if (typeof window === "undefined") return true;
    const stored = window.localStorage.getItem("sidebar-expanded");
    return stored === null ? true : stored === "true";
  });
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const pathname = usePathname();
  const router = useRouter();
  const { user, logout } = useAuth();
  const { theme, setTheme } = useTheme();

  useEffect(() => {
    const frame = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (mounted && user) {
      // Update document title
      document.title = user.companyName || "Aiforhomebuilder";

      // Update favicon
      const logoUrl = user.companyLogo || "/favicon.ico";
      let link: HTMLLinkElement | null = document.querySelector("link[rel~='icon']");
      if (!link) {
        link = document.createElement("link");
        link.rel = "icon";
        document.head.appendChild(link);
      }
      link.href = logoUrl;
    }
  }, [mounted, user]);

  useEffect(() => {
    if (mounted && user?.isSuperAdmin) {
      router.push("/admin");
    }
  }, [user, mounted, router]);

  const warrantyLocked =
    workspace === "warranty" &&
    !!user &&
    !user.isSuperAdmin &&
    !!user.verificationStatus &&
    user.verificationStatus !== "VERIFIED";

  const navItems = workspace === "warranty" ? warrantyNavItems : salesNavItems;
  const filteredNav = navItems.filter((item) => {
    if (!user || !item.roles.includes(user.role)) return false;
    // Items without a permission key are open to anyone holding the role.
    return !item.permission || hasSalesPermission(user, item.permission);
  });
  const getInitials = (name: string) =>
    name.split(" ").map((n) => n[0]).join("").toUpperCase();
  const companyName = user?.companyName || "Aiforhomebuilder";
  const sidebarCompanyName = companyName.trim().split(/\s+/)[0] || companyName;
  const workspaceLabel = workspace === "warranty" ? "Warranty Care" : "Sales Hub";
  const WorkspaceIcon = workspace === "warranty" ? Bot : Layers;

  const handleWorkspaceSwitch = (ws: "warranty" | "sales") => {
    localStorage.setItem("last-workspace", ws);
    document.cookie = `last-workspace=${ws}; path=/; max-age=31536000; SameSite=Lax`;
    router.push(`/${ws}/dashboard`);
  };


  const toggleSidebar = () => {
    const newVal = !sidebarExpanded;
    setSidebarExpanded(newVal);
    localStorage.setItem("sidebar-expanded", String(newVal));
  };
  const closeMobileSidebar = () => setMobileSidebarOpen(false);

  // Sidebar width based on expansion state
  const sidebarWidth = sidebarExpanded ? 256 : 80;

  if (!mounted) return null;

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      {/* Desktop Sidebar - visible from md upwards */}
      <motion.aside
        initial={false}
        animate={{ width: sidebarWidth }}
        transition={{ duration: 0.2, ease: "easeInOut" }}
        className="fixed inset-y-0 left-0 z-50 hidden md:block bg-sidebar text-white shadow-xl"
      >
        <div className="flex h-full flex-col">
          {/* Header with logo and toggle */}
          <div className={`flex h-16 items-center ${sidebarExpanded ? "justify-between px-4" : "justify-center px-0"}`}>
            {sidebarExpanded ? (
              <button
                onClick={() => router.push(workspace === "warranty" ? "/warranty/dashboard" : "/sales/dashboard")}
                className="flex min-w-0 items-center gap-3.5 hover:opacity-80 transition"
                title={companyName}
              >
                {user?.companyLogo ? (
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-white/95 p-1 ring-1 ring-white/15">
                    <img src={user.companyLogo} alt="Logo" className="h-full w-full object-contain" />
                  </span>
                ) : (
                  <BrandLogo onDark alt="AI4HB" className="h-9 w-auto shrink-0 object-contain" />
                )}
                <span className="min-w-0 truncate text-xl font-bold tracking-tight">{sidebarCompanyName}</span>
              </button>
            ) : (
              null
            )}
            <Button variant="ghost" size="icon" onClick={toggleSidebar} className="text-white hover:bg-white/10">
              {sidebarExpanded ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}
            </Button>
          </div>
          <Separator className="bg-white/10" />

          {/* Workspace Switcher */}
          {user && (user?.hasWarrantyAccess || user?.hasSalesAccess) && (
            <div className="px-3 py-2">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    className={`flex w-full items-center rounded-lg bg-white/5 border border-white/10 text-sm text-white hover:bg-white/10 transition cursor-pointer outline-hidden ${
                      sidebarExpanded ? "justify-between gap-2 px-3 py-2" : "h-11 justify-center px-0"
                    }`}
                    title={`Switch workspace: ${workspaceLabel}`}
                  >
                    {sidebarExpanded ? (
                      <div className="flex items-center gap-2 overflow-hidden text-left">
                        <span className="font-semibold text-[10px] tracking-wider uppercase text-white/40 shrink-0">WS:</span>
                        <span className="font-medium text-white text-xs truncate">{workspaceLabel}</span>
                      </div>
                    ) : (
                      <WorkspaceIcon className="h-5 w-5 text-white/85" />
                    )}
                    {sidebarExpanded && <ChevronDown className="h-3.5 w-3.5 text-white/50 shrink-0" />}
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-48">
                  <DropdownMenuLabel className="text-xs">Switch Workspace</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {user?.hasWarrantyAccess && (
                    <DropdownMenuItem onClick={() => handleWorkspaceSwitch("warranty")} className="flex items-center justify-between text-xs cursor-pointer">
                      <span>Warranty Care</span>
                      {workspace === "warranty" && <Check className="h-3.5 w-3.5" />}
                    </DropdownMenuItem>
                  )}
                  {user?.hasSalesAccess && (
                    <DropdownMenuItem onClick={() => handleWorkspaceSwitch("sales")} className="flex items-center justify-between text-xs cursor-pointer">
                      <span>Sales Hub</span>
                      {workspace === "sales" && <Check className="h-3.5 w-3.5" />}
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}

          {/* Navigation */}
          <nav className="no-scrollbar flex-1 space-y-1 overflow-y-auto p-3">
            {filteredNav.map((item) => {
              const isActive = pathname === item.href;
              return (
                <Link key={item.name} href={item.href}>
                  <motion.div
                    whileHover={{ x: 4 }}
                    transition={{ duration: 0.2 }}
                    className={`flex items-center space-x-3 rounded-md px-3 py-2 text-sm font-medium transition-all ${isActive
                      ? "border-l-4 border-l-secondary bg-white/5 pl-2 text-white font-semibold"
                      : "text-white/80 hover:bg-white/10 hover:text-white"
                      }`}
                    title={sidebarExpanded ? undefined : item.name}
                  >
                    <item.icon className="h-5 w-5 shrink-0" />
                    {sidebarExpanded && <span>{item.name}</span>}
                  </motion.div>
                </Link>
              );
            })}
          </nav>

          {/* Bottom section: theme toggle + profile */}
          <div className="border-t border-white/10 p-4 space-y-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              className={`w-full text-white/80 hover:bg-white/10 hover:text-white ${
                sidebarExpanded ? "justify-start" : "justify-center px-0"
              }`}
              title={theme === "dark" ? "Light Mode" : "Dark Mode"}
            >
              {theme === "dark" ? (
                <Sun className={`h-4 w-4 ${sidebarExpanded ? "mr-2" : ""}`} />
              ) : (
                <Moon className={`h-4 w-4 ${sidebarExpanded ? "mr-2" : ""}`} />
              )}
              {sidebarExpanded && (theme === "dark" ? "Light Mode" : "Dark Mode")}
            </Button>

            {user?.role === "admin" ? (
              // ADMIN: show company logo + company name + logout icon
              <div className={`w-full flex items-center rounded-md py-2 text-sm font-medium text-white/80 transition-all ${
                sidebarExpanded ? "justify-between gap-3 px-3" : "justify-center px-0"
              }`}>
                <div className={`flex items-center ${sidebarExpanded ? "gap-3" : "justify-center"}`}>
                  <div className="relative">
                    <Avatar className="h-8 w-8">
                      <AvatarImage src={user?.avatar} />
                      <AvatarFallback className="bg-secondary text-primary text-xs">
                        {user ? getInitials(user.companyName || user.name) : "C"}
                      </AvatarFallback>
                    </Avatar>
                    <Circle className={`absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full ${user?.online ? "bg-green-500 ring-1 ring-white" : "bg-gray-400"}`} />
                  </div>
                  {sidebarExpanded && (
                    <div className="flex-1 text-left overflow-hidden">
                      <p className="text-sm font-medium text-white truncate">
                        {sidebarCompanyName || user?.name}
                      </p>
                      <p className="text-xs text-white/60 capitalize">{user?.role}</p>
                    </div>
                  )}
                </div>
                {sidebarExpanded && (
                  <Button variant="ghost" size="icon" onClick={logout} className="h-8 w-8 text-white/80 hover:text-white hover:bg-white/10 shrink-0" title="Logout">
                    <LogOut className="h-4 w-4" />
                  </Button>
                )}
              </div>
            ) : (
              <div className={`w-full flex items-center rounded-md py-2 text-sm font-medium text-white/80 transition-all ${
                sidebarExpanded ? "justify-between gap-3 px-3" : "justify-center px-0"
              }`}>
                <div className={`flex items-center ${sidebarExpanded ? "gap-3" : "justify-center"}`}>
                  <div className="relative">
                    <Avatar className="h-8 w-8">
                      <AvatarImage src={user?.avatar} />
                      <AvatarFallback className="bg-secondary text-primary text-xs">
                        {user ? getInitials(user.name) : "U"}
                      </AvatarFallback>
                    </Avatar>
                    <Circle className={`absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full ${user?.online ? "bg-green-500 ring-1 ring-white" : "bg-gray-400"}`} />
                  </div>
                  {sidebarExpanded && (
                    <div className="flex-1 text-left overflow-hidden">
                      <p className="text-sm font-medium text-white truncate">
                        {user?.name}
                      </p>
                      <p className="text-xs text-white/60 capitalize">{user?.role}</p>
                    </div>
                  )}
                </div>
                {sidebarExpanded && (
                  <Button variant="ghost" size="icon" onClick={logout} className="h-8 w-8 text-white/80 hover:text-white hover:bg-white/10 shrink-0" title="Logout">
                    <LogOut className="h-4 w-4" />
                  </Button>
                )}
              </div>
            )}
          </div>
        </div>
      </motion.aside>

      {/* Main content area - margin-left adjusts based on sidebar state */}
      <main
        className={`no-scrollbar flex-1 flex flex-col transition-all duration-200 ease-in-out overflow-auto ${sidebarExpanded ? "md:ml-64" : "md:ml-20"
          }`}
      >
        {/* Mobile header (visible only on < md) */}
        <header className="sticky top-0 z-40 flex h-16 items-center justify-between border-b bg-background px-4 shadow-sm md:hidden">
          <Button variant="ghost" size="icon" className="shrink-0" aria-label="Open navigation menu" onClick={() => setMobileSidebarOpen(true)}>
            <Menu className="h-5 w-5" />
          </Button>
          <div className="flex min-w-0 items-center gap-3">
            <BrandLogo src={user?.companyLogo} className="h-8 w-auto shrink-0 object-contain rounded-sm" />
            <span className="truncate font-bold">{user?.companyName || "Aiforhomebuilder"}</span>
          </div>
          <Button variant="ghost" size="icon" className="shrink-0" aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"} onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
            {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </Button>
        </header >

        {/* Mobile Drawer Sidebar */}
        <AnimatePresence>
          {mobileSidebarOpen && (
            <>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 z-50 bg-black/50 md:hidden"
                onClick={closeMobileSidebar}
              />
              <motion.aside
                initial={{ x: "-100%" }}
                animate={{ x: 0 }}
                exit={{ x: "-100%" }}
                transition={{ type: "tween", duration: 0.3 }}
                className="fixed top-0 left-0 z-50 h-full w-64 bg-sidebar text-white shadow-xl md:hidden"
              >
                <div className="flex h-full flex-col">
                  <div className="flex h-16 items-center justify-between px-4">
                    <div className="flex min-w-0 items-center gap-3.5">
                      <BrandLogo src={user?.companyLogo} onDark className="h-9 w-auto shrink-0 object-contain rounded-md" />
                      <span className="truncate text-xl font-bold">{user?.companyName || "Aiforhomebuilder"}</span>
                    </div>
                    <Button variant="ghost" size="icon" aria-label="Close navigation menu" onClick={closeMobileSidebar} className="shrink-0 text-white hover:bg-white/10">
                      <X className="h-5 w-5" />
                    </Button>
                  </div>
                  <Separator className="bg-white/10" />

                  {/* Mobile Workspace Switcher — mirrors the desktop one above. */}
                  {user && (user?.hasWarrantyAccess || user?.hasSalesAccess) && (
                    <div className="px-3 py-2">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button className="flex w-full items-center justify-between gap-2 rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm text-white hover:bg-white/10 transition cursor-pointer outline-hidden">
                            <div className="flex items-center gap-2 overflow-hidden text-left">
                              <span className="font-semibold text-[10px] tracking-wider uppercase text-white/40 shrink-0">WS:</span>
                              <span className="font-medium text-white text-xs truncate">
                                {workspace === "warranty" ? "Warranty Care" : "Sales Hub"}
                              </span>
                            </div>
                            <ChevronDown className="h-3.5 w-3.5 text-white/50 shrink-0" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="start" className="w-48">
                          <DropdownMenuLabel className="text-xs">Switch Workspace</DropdownMenuLabel>
                          <DropdownMenuSeparator />
                          {user?.hasWarrantyAccess && (
                            <DropdownMenuItem onClick={() => { closeMobileSidebar(); handleWorkspaceSwitch("warranty"); }} className="flex items-center justify-between text-xs cursor-pointer">
                              <span>Warranty Care</span>
                              {workspace === "warranty" && <Check className="h-3.5 w-3.5" />}
                            </DropdownMenuItem>
                          )}
                          {user?.hasSalesAccess && (
                            <DropdownMenuItem onClick={() => { closeMobileSidebar(); handleWorkspaceSwitch("sales"); }} className="flex items-center justify-between text-xs cursor-pointer">
                              <span>Sales Hub</span>
                              {workspace === "sales" && <Check className="h-3.5 w-3.5" />}
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  )}

                  <nav className="no-scrollbar flex-1 space-y-1 overflow-y-auto p-3">
                    {filteredNav.map((item) => (
                      <Link key={item.name} href={item.href} onClick={closeMobileSidebar}>
                        <div className={`flex items-center space-x-3 rounded-md px-3 py-2 text-sm font-medium transition-all ${pathname === item.href
                          ? "bg-white/10 text-white font-semibold"
                          : "text-white/80 hover:bg-white/10 hover:text-white"
                          }`}>
                          <item.icon className="h-5 w-5" />
                          <span>{item.name}</span>
                        </div>
                      </Link>
                    ))}
                  </nav>
                  <div className="space-y-3 border-t border-white/10 p-4">
                    <div className="flex min-w-0 items-center gap-3 px-1">
                      <Avatar className="h-8 w-8 shrink-0">
                        <AvatarImage src={user?.avatar} />
                        <AvatarFallback className="bg-secondary text-primary text-xs">
                          {user
                            ? getInitials(
                                user.role === "admin"
                                  ? user.companyName || user.name
                                  : user.name,
                              )
                            : "U"}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0 flex-1 text-left">
                        <p className="truncate text-sm font-medium text-white">
                          {user?.role === "admin"
                            ? sidebarCompanyName || user?.name
                            : user?.name}
                        </p>
                        <p className="text-xs capitalize text-white/60">{user?.role}</p>
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      className="w-full justify-start text-white/80 hover:bg-white/10"
                      onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
                    >
                      {theme === "dark" ? <Sun className="h-4 w-4 mr-2" /> : <Moon className="h-4 w-4 mr-2" />}
                      {theme === "dark" ? "Light Mode" : "Dark Mode"}
                    </Button>
                    <Button
                      variant="ghost"
                      className="w-full justify-start text-white/80 hover:bg-white/10 hover:text-white"
                      onClick={logout}
                    >
                      <LogOut className="h-4 w-4 mr-2" />
                      Logout
                    </Button>
                  </div>
                </div>
              </motion.aside>
            </>
          )}
        </AnimatePresence>

        {/* Page content wrapper with padding */}
        <div className="relative flex-1">
          <div
            className={`p-4 md:p-6 ${
              warrantyLocked
                ? "pointer-events-none select-none blur-[6px]"
                : ""
            }`}
            aria-hidden={warrantyLocked}
          >
            {children}
          </div>
          {warrantyLocked && <VerificationGate />}
        </div>
      </main>
    </div>
  );
}
