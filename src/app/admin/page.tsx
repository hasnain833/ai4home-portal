"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ShieldCheck, Building2, Users as UsersIcon, Sparkles } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";

export default function SuperAdminOverviewPage() {
  const { user, isLoading } = useAuth();
  const router = useRouter();
  const [counts, setCounts] = useState({ companies: 0, users: 0, activeWorkspaces: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isLoading && !user) {
      router.push("/login");
      return;
    }
    if (!isLoading && user && !user.isSuperAdmin) {
      router.push("/");
    }
  }, [user, isLoading, router]);

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const [compRes, usersRes] = await Promise.all([
          fetch("/api/admin/companies"),
          fetch("/api/admin/users")
        ]);
        if (compRes.ok && usersRes.ok) {
          const comps = await compRes.json();
          const usrs = await usersRes.json();
          setCounts({
            companies: comps.length,
            users: usrs.length,
            activeWorkspaces: comps.filter((c: any) => c.warrantyEnabled || c.salesEnabled).length
          });
        }
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    };
    if (user?.isSuperAdmin) fetchStats();
  }, [user]);

  if (loading) {
    return <div className="p-8 text-center text-muted-foreground">Loading overview...</div>;
  }

  return (
    <div className="space-y-6">
      <Card className="overflow-hidden bg-card border-border shadow-sm">
        <CardHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="inline-flex items-center gap-2 text-[#b48c3c] mb-2">
                <ShieldCheck className="h-5 w-5" />
                <CardTitle className="text-2xl font-semibold text-foreground">
                  Super Admin Overview
                </CardTitle>
              </div>
              <p className="max-w-2xl text-sm text-muted-foreground">
                Manage tenant workspace access, review admin accounts, and keep
                the entire portal secure from one central place.
              </p>
            </div>
            <div className="rounded-2xl bg-muted/50 border border-border p-4 min-w-[200px]">
              <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground font-bold mb-1">
                Root Access Active
              </p>
              <p className="text-sm font-semibold text-foreground">
                {user?.name || user?.email}
              </p>
              <p className="text-xs text-[#b48c3c] font-medium mt-0.5">Super Admin</p>
            </div>
          </div>
        </CardHeader>
      </Card>

      <div className="grid gap-6 md:grid-cols-3">
        <Card className="bg-card border-border shadow-sm hover:shadow-md transition-shadow">
          <CardContent className="p-6">
            <div className="flex items-center gap-4">
              <div className="h-12 w-12 rounded-xl bg-[#b48c3c]/10 flex items-center justify-center text-[#b48c3c]">
                <Building2 className="h-6 w-6" />
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground">Tenant Companies</p>
                <p className="text-3xl font-bold text-foreground">{counts.companies}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card border-border shadow-sm hover:shadow-md transition-shadow">
          <CardContent className="p-6">
            <div className="flex items-center gap-4">
              <div className="h-12 w-12 rounded-xl bg-[#b48c3c]/10 flex items-center justify-center text-[#b48c3c]">
                <UsersIcon className="h-6 w-6" />
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground">Total Users</p>
                <p className="text-3xl font-bold text-foreground">{counts.users}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card border-border shadow-sm hover:shadow-md transition-shadow">
          <CardContent className="p-6">
            <div className="flex items-center gap-4">
              <div className="h-12 w-12 rounded-xl bg-[#b48c3c]/10 flex items-center justify-center text-[#b48c3c]">
                <Sparkles className="h-6 w-6" />
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground">Active Workspaces</p>
                <p className="text-3xl font-bold text-foreground">{counts.activeWorkspaces}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
