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
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  X,
  Users,
  Pencil,
  Activity,
  Check,
  Layers,
  CalendarDays,
} from "lucide-react";
import { Button } from "@/components/ui/button";
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Camera, Circle } from "lucide-react";

const warrantyNavItems = [
  { name: "Dashboard", href: "/warranty/dashboard", icon: LayoutDashboard, roles: ["admin", "staff", "homeowner"] },
  { name: "AI Assistant", href: "/warranty/chat", icon: Bot, roles: ["admin", "staff", "homeowner"] },
  { name: "Properties", href: "/warranty/properties", icon: Building2, roles: ["admin", "staff", "homeowner"] },
  { name: "Tickets", href: "/warranty/tickets", icon: Ticket, roles: ["admin", "staff", "homeowner"] },
  { name: "Team", href: "/warranty/dashboard/team", icon: Users, roles: ["admin", "staff"] },
  { name: "Homeowners", href: "/warranty/dashboard/homeowners", icon: User, roles: ["admin", "staff"] },
  // { name: "Integrations", href: "/warranty/integrations", icon: Plug, roles: ["admin"] },
  { name: "Knowledge Base", href: "/warranty/knowledge-base", icon: Database, roles: ["admin", "staff"] },
  { name: "Company", href: "/warranty/company", icon: Building2, roles: ["admin", "staff"] },
  { name: "Reports", href: "/warranty/reports", icon: BarChart3, roles: ["admin", "staff"] },
];

const salesNavItems = [
  { name: "Dashboard", href: "/sales/dashboard", icon: LayoutDashboard, roles: ["admin", "staff"] },
  { name: "Leads", href: "/sales/leads", icon: Users, roles: ["admin", "staff"] },
  { name: "Campaigns", href: "/sales/campaigns", icon: Layers, roles: ["admin", "staff"] },
  { name: "Content Calendar", href: "/sales/calendar", icon: CalendarDays, roles: ["admin", "staff"] },
  { name: "Announcements", href: "/sales/announcements", icon: Bot, roles: ["admin", "staff"] },
  { name: "Appointments", href: "/sales/scheduling", icon: CalendarDays, roles: ["admin", "staff"] },
  { name: "News Feed", href: "/sales/news", icon: Activity, roles: ["admin", "staff"] },
  { name: "Blog Posts", href: "/sales/blog", icon: Pencil, roles: ["admin", "staff"] },
  { name: "Automations", href: "/sales/automations", icon: Plug, roles: ["admin"] },
  { name: "Settings", href: "/sales/settings", icon: Building2, roles: ["admin", "staff"] },
];

export default function PortalLayout({
  children,
  workspace = "warranty",
}: {
  children: React.ReactNode;
  workspace?: "warranty" | "sales";
}) {
  const [sidebarExpanded, setSidebarExpanded] = useState(true);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [editedName, setEditedName] = useState("");
  const [mounted, setMounted] = useState(false);
  const pathname = usePathname();
  const router = useRouter();
  const { user, logout, updateProfile, updateAvatar } = useAuth();
  const { theme, setTheme } = useTheme();

  useEffect(() => setMounted(true), []);

  const navItems = workspace === "warranty" ? warrantyNavItems : salesNavItems;
  const filteredNav = navItems.filter((item) => user && item.roles.includes(user.role));
  const getInitials = (name: string) =>
    name.split(" ").map((n) => n[0]).join("").toUpperCase();

  const handleWorkspaceSwitch = (ws: "warranty" | "sales") => {
    localStorage.setItem("last-workspace", ws);
    document.cookie = `last-workspace=${ws}; path=/; max-age=31536000; SameSite=Lax`;
    router.push(`/${ws}/dashboard`);
  };

  const handleAvatarUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => updateAvatar(reader.result as string);
      reader.readAsDataURL(file);
    }
  };

  const toggleSidebar = () => setSidebarExpanded(!sidebarExpanded);
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
          <div className="flex h-16 items-center justify-between px-4">
            <button onClick={() => router.push(workspace === "warranty" ? "/warranty/dashboard" : "/sales/dashboard")} className="flex items-center gap-3.5 hover:opacity-80 transition">
              <img src={user?.companyLogo || "/logo.png"} alt="Logo" className="h-9 w-auto object-contain rounded-md" />
              {sidebarExpanded && (
                <span className="text-xl font-bold tracking-tight">{user?.companyName || "Aiforhomebuilder"}</span>
              )}
            </button>
            <Button variant="ghost" size="icon" onClick={toggleSidebar} className="text-white hover:bg-white/10">
              {sidebarExpanded ? <ChevronLeft className="h-5 w-5" /> : <ChevronRight className="h-5 w-5" />}
            </Button>
          </div>
          <Separator className="bg-white/10" />

          {/* Workspace Switcher — hidden until multi-workspace is enabled; restore by replacing `false` with the real condition */}
          {false && user && (user?.hasWarrantyAccess || user?.hasSalesAccess) && (
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
          <nav className="flex-1 space-y-1 p-3 overflow-y-auto">
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
              className="w-full justify-start text-white/80 hover:bg-white/10 hover:text-white"
            >
              {theme === "dark" ? <Sun className="h-4 w-4 mr-2" /> : <Moon className="h-4 w-4 mr-2" />}
              {sidebarExpanded && (theme === "dark" ? "Light Mode" : "Dark Mode")}
            </Button>

            {user?.role === "admin" ? (
              // ADMIN: show company logo + company name + logout icon
              <div className="w-full flex items-center justify-between gap-3 rounded-md px-3 py-2 text-sm font-medium text-white/80 transition-all">
                <div className="flex items-center gap-3">
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
                        {user?.companyName || user?.name}
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
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="w-full flex items-center justify-start gap-3 rounded-md px-3 py-2 text-sm font-medium text-white/80 hover:bg-white/10 hover:text-white transition-all outline-hidden cursor-pointer">
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
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuLabel>My Account</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => setProfileOpen(true)}>
                    <User className="mr-2 h-4 w-4" /> Profile Settings
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={logout}>
                    <LogOut className="mr-2 h-4 w-4" /> Logout
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </div>
      </motion.aside>

      {/* Main content area - margin-left adjusts based on sidebar state */}
      <main
        className={`flex-1 flex flex-col transition-all duration-200 ease-in-out overflow-auto ${sidebarExpanded ? "md:ml-64" : "md:ml-20"
          }`}
      >
        {/* Mobile header (visible only on < md) */}
        <header className="sticky top-0 z-40 flex h-16 items-center justify-between border-b bg-background px-4 shadow-sm md:hidden">
          <Button variant="ghost" size="icon" onClick={() => setMobileSidebarOpen(true)}>
            <Menu className="h-5 w-5" />
          </Button>
          <div className="flex items-center gap-3">
            <img src={user?.companyLogo || "/logo.png"} alt="Logo" className="h-7 w-auto object-contain rounded-sm" />
            <span className="font-bold">{user?.companyName || "Aiforhomebuilder"}</span>
          </div>
          <Button variant="ghost" size="icon" onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
            {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </Button>
        </header>

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
                    <div className="flex items-center gap-3.5">
                      <img src={user?.companyLogo || "/logo.png"} alt="Logo" className="h-9 w-auto object-contain rounded-md" />
                      <span className="text-xl font-bold">{user?.companyName || "Aiforhomebuilder"}</span>
                    </div>
                    <Button variant="ghost" size="icon" onClick={closeMobileSidebar} className="text-white hover:bg-white/10">
                      <X className="h-5 w-5" />
                    </Button>
                  </div>
                  <Separator className="bg-white/10" />

                  {/* Mobile Workspace Switcher — hidden until multi-workspace is enabled; restore by replacing `false` with the real condition */}
                  {false && user && (user?.hasWarrantyAccess || user?.hasSalesAccess) && (
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

                  <nav className="flex-1 space-y-1 p-3">
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
                  <div className="border-t border-white/10 p-4">
                    <Button
                      variant="ghost"
                      className="w-full justify-start text-white/80 hover:bg-white/10"
                      onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
                    >
                      {theme === "dark" ? <Sun className="h-4 w-4 mr-2" /> : <Moon className="h-4 w-4 mr-2" />}
                      {theme === "dark" ? "Light Mode" : "Dark Mode"}
                    </Button>
                  </div>
                </div>
              </motion.aside>
            </>
          )}
        </AnimatePresence>

        {/* Page content wrapper with padding */}
        <div className="flex-1 p-4 md:p-6">{children}</div>
      </main>

      {/* Profile Settings Dialog */}
      <Dialog open={profileOpen} onOpenChange={(open) => { setProfileOpen(open); if (!open) setIsEditingProfile(false); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <div className="flex items-center justify-between pr-6">
              <DialogTitle>Profile Settings</DialogTitle>
              {!isEditingProfile ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5 h-8"
                  onClick={() => { setEditedName(user?.name || ""); setIsEditingProfile(true); }}
                >
                  <Pencil className="h-3.5 w-3.5" />
                  Edit
                </Button>
              ) : (
                <div className="flex gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="gap-1.5 h-8 text-muted-foreground"
                    onClick={() => setIsEditingProfile(false)}
                  >
                    <X className="h-3.5 w-3.5" />
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    className="gap-1.5 h-8 bg-[#0F3B3D] hover:bg-[#0F3B3D]/90"
                    onClick={() => { updateProfile({ name: editedName }); setIsEditingProfile(false); }}
                  >
                    <Check className="h-3.5 w-3.5" />
                    Save
                  </Button>
                </div>
              )}
            </div>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex flex-col items-center gap-4">
              <div className="relative">
                <Avatar className="h-20 w-20">
                  <AvatarImage src={user?.avatar} />
                  <AvatarFallback className="text-2xl bg-secondary text-primary">
                    {user ? getInitials(user.name) : "U"}
                  </AvatarFallback>
                </Avatar>
                <label htmlFor="avatar-upload" className="absolute bottom-0 right-0 cursor-pointer rounded-full bg-primary p-1 text-white shadow-sm">
                  <Camera className="h-4 w-4" />
                  <input id="avatar-upload" type="file" accept="image/*" className="hidden" onChange={handleAvatarUpload} />
                </label>
              </div>
              <Badge variant="outline" className={user?.online ? "border-green-500 text-green-700 dark:text-green-400" : "border-gray-300"}>
                <Circle className={`mr-1 h-2 w-2 ${user?.online ? "fill-green-500" : "fill-gray-400"}`} />
                {user?.online ? "Online" : "Offline"}
              </Badge>
            </div>

            {/* Full Name */}
            <div>
              <Label>Full Name</Label>
              {isEditingProfile ? (
                <Input
                  value={editedName}
                  onChange={(e) => setEditedName(e.target.value)}
                  className="mt-1"
                  autoFocus
                />
              ) : (
                <Input value={user?.name || ""} disabled className="bg-muted mt-1" />
              )}
            </div>

            {/* Email — always locked */}
            <div>
              <Label className="flex items-center gap-1.5">
                Email
                <span className="text-[10px] font-normal text-muted-foreground bg-muted px-1.5 py-0.5 rounded">Cannot be changed</span>
              </Label>
              <Input value={user?.email || ""} disabled className="bg-muted mt-1" />
            </div>

            {/* Role */}
            <div>
              <Label>Role</Label>
              <Input
                value={user?.role ? user.role.charAt(0).toUpperCase() + user.role.slice(1) : ""}
                disabled
                className="bg-muted mt-1"
              />
            </div>

            {/* Company — read-only info, shown as info text not a field */}
            {user?.companyName && (
              <p className="text-xs text-muted-foreground text-center">
                Member of <span className="font-medium">{user.companyName}</span>
              </p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}