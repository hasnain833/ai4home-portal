"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "next-themes";
import { motion } from "framer-motion";
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

const navItems = [
  {
    name: "Dashboard",
    href: "/dashboard",
    icon: LayoutDashboard,
    roles: ["admin", "staff", "homeowner"],
  },
  {
    name: "Tickets",
    href: "/tickets",
    icon: Ticket,
    roles: ["admin", "staff", "homeowner"],
  },
  { name: "Integrations", href: "/integrations", icon: Plug, roles: ["admin"] },
  { name: "Agent Config", href: "/agent-config", icon: Bot, roles: ["admin"] },
  {
    name: "Knowledge Base",
    href: "/knowledge-base",
    icon: Database,
    roles: ["admin", "staff"],
  },
  { name: "Company", href: "/company", icon: Building2, roles: ["admin"] },
  {
    name: "Reports",
    href: "/reports",
    icon: BarChart3,
    roles: ["admin", "staff"],
  },
];

export default function PortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [profileOpen, setProfileOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const pathname = usePathname();
  const router = useRouter();
  const { user, logout, updateProfile, updateAvatar } = useAuth();
  const { theme, setTheme } = useTheme();

  useEffect(() => setMounted(true), []);

  const filteredNav = navItems.filter(
    (item) => user && item.roles.includes(user.role),
  );
  const getInitials = (name: string) =>
    name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase();

  const handleAvatarUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => updateAvatar(reader.result as string);
      reader.readAsDataURL(file);
    }
  };

  const toggleSidebar = () => setSidebarOpen(!sidebarOpen);
  const handleLogoClick = () => router.push("/dashboard");

  if (!mounted) return null;

  return (
    <div className="flex h-screen bg-background">
      {/* Sidebar – always navy */}
      <motion.aside
        initial={false}
        animate={{ width: sidebarOpen ? 256 : 80 }}
        transition={{ duration: 0.2, ease: "easeInOut" }}
        className="fixed inset-y-0 left-0 z-50 hidden md:block bg-sidebar text-white shadow-xl"
      >
        <div className="flex h-full flex-col">
          <div className="flex h-16 items-center justify-between px-4">
            <button
              onClick={handleLogoClick}
              className="flex items-center gap-2 hover:opacity-80 transition"
            >
              {sidebarOpen ? (
                <span className="text-xl font-bold tracking-tight">
                  Ai.Lumen Care
                </span>
              ) : (
                <span className="text-xl font-bold">AL</span>
              )}
            </button>
            <Button
              variant="ghost"
              size="icon"
              onClick={toggleSidebar}
              className="text-white hover:bg-white/10"
            >
              {sidebarOpen ? (
                <ChevronLeft className="h-5 w-5" />
              ) : (
                <ChevronRight className="h-5 w-5" />
              )}
            </Button>
          </div>
          <Separator className="bg-white/10" />
          <nav className="flex-1 space-y-1 p-3">
            {filteredNav.map((item) => {
              const isActive = pathname === item.href;
              return (
                <Link key={item.name} href={item.href}>
                  <motion.div
                    whileHover={{ x: 4 }}
                    transition={{ duration: 0.2 }}
                    className={`flex items-center space-x-3 rounded-md px-3 py-2 text-sm font-medium transition-all ${
                      isActive
                        ? "border-l-4 border-l-secondary bg-white/5 pl-2 text-white font-semibold"
                        : "text-white/80 hover:bg-white/10 hover:text-white"
                    }`}
                  >
                    <item.icon className="h-5 w-5" />
                    {sidebarOpen && <span>{item.name}</span>}
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
              {theme === "dark" ? (
                <Sun className="h-4 w-4 mr-2" />
              ) : (
                <Moon className="h-4 w-4 mr-2" />
              )}
              {sidebarOpen && (theme === "dark" ? "Light Mode" : "Dark Mode")}
            </Button>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  className="w-full justify-start gap-3 text-white/80 hover:bg-white/10 hover:text-white"
                >
                  <div className="relative">
                    <Avatar className="h-8 w-8">
                      <AvatarImage src={user?.avatar} />
                      <AvatarFallback className="bg-secondary text-primary text-xs">
                        {user ? getInitials(user.name) : "U"}
                      </AvatarFallback>
                    </Avatar>
                    <Circle
                      className={`absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full ${user?.online ? "bg-green-500 ring-1 ring-white" : "bg-gray-400"}`}
                    />
                  </div>
                  {sidebarOpen && (
                    <div className="flex-1 text-left">
                      <p className="text-sm font-medium">{user?.name}</p>
                      <p className="text-xs text-white/60 capitalize">
                        {user?.role}
                      </p>
                    </div>
                  )}
                </Button>
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
          </div>
        </div>
      </motion.aside>

      {/* Main content area */}
      <div
        className={`flex flex-1 flex-col transition-all duration-300 ${sidebarOpen ? "md:ml-64" : "md:ml-20"}`}
      >
        {/* Mobile header */}
        <header className="sticky top-0 z-40 flex h-16 items-center justify-between border-b bg-background px-4 shadow-sm md:hidden">
          <Button variant="ghost" size="icon" onClick={toggleSidebar}>
            <Menu className="h-5 w-5" />
          </Button>
          <span className="font-bold">Ai.Lumen Care</span>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          >
            {theme === "dark" ? (
              <Sun className="h-4 w-4" />
            ) : (
              <Moon className="h-4 w-4" />
            )}
          </Button>
        </header>

        <main className="flex-1 overflow-auto p-4 md:p-6">{children}</main>
      </div>

      {/* Profile Settings Dialog */}
      <Dialog open={profileOpen} onOpenChange={setProfileOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Profile Settings</DialogTitle>
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
                <label
                  htmlFor="avatar-upload"
                  className="absolute bottom-0 right-0 cursor-pointer rounded-full bg-primary p-1 text-white shadow-sm"
                >
                  <Camera className="h-4 w-4" />
                  <input
                    id="avatar-upload"
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handleAvatarUpload}
                  />
                </label>
              </div>
              <Badge
                variant="outline"
                className={
                  user?.online
                    ? "border-green-500 text-green-700 dark:text-green-400"
                    : "border-gray-300"
                }
              >
                <Circle
                  className={`mr-1 h-2 w-2 ${user?.online ? "fill-green-500" : "fill-gray-400"}`}
                />
                {user?.online ? "Online" : "Offline"}
              </Badge>
            </div>
            <div>
              <Label>Full Name</Label>
              <Input
                value={user?.name || ""}
                onChange={(e) => updateProfile({ name: e.target.value })}
              />
            </div>
            <div>
              <Label>Email</Label>
              <Input value={user?.email || ""} disabled className="bg-muted" />
            </div>
            <div>
              <Label>Role</Label>
              <Input
                value={
                  user?.role
                    ? user.role.charAt(0).toUpperCase() + user.role.slice(1)
                    : ""
                }
                disabled
                className="bg-muted"
              />
            </div>
            {user?.companyName && (
              <div>
                <Label>Company</Label>
                <Input value={user.companyName} disabled className="bg-muted" />
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
