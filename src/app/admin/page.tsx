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
    return <div className="p-8 text-center text-slate-500">Loading overview...</div>;
  }

  return (
    <div className="space-y-6">
      <Card className="overflow-hidden bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm">
        <CardHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="inline-flex items-center gap-2 text-[#0F3B3D] dark:text-[#b48c3c] mb-2">
                <ShieldCheck className="h-5 w-5" />
                <CardTitle className="text-2xl font-semibold">
                  Super Admin Overview
                </CardTitle>
              </div>
              <p className="max-w-2xl text-sm text-slate-500 dark:text-slate-400">
                Manage tenant workspace access, review user accounts, and keep
                the entire portal secure from one central place.
              </p>
            </div>
            <div className="rounded-2xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 p-4 min-w-[200px]">
              <p className="text-[10px] uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400 font-bold mb-1">
                Root Access Active
              </p>
              <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                {user?.name || user?.email}
              </p>
              <p className="text-xs text-slate-500 mt-0.5">Super Admin</p>
            </div>
          </div>
        </CardHeader>
      </Card>

      <div className="grid gap-6 md:grid-cols-3">
        <Card className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm hover:shadow-md transition-shadow">
          <CardContent className="p-6">
            <div className="flex items-center gap-4">
              <div className="h-12 w-12 rounded-xl bg-blue-50 dark:bg-blue-900/20 flex items-center justify-center text-blue-600 dark:text-blue-400">
                <Building2 className="h-6 w-6" />
              </div>
              <div>
                <p className="text-sm font-medium text-slate-500 dark:text-slate-400">Tenant Companies</p>
                <p className="text-3xl font-bold text-slate-900 dark:text-slate-100">{counts.companies}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        
        <Card className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm hover:shadow-md transition-shadow">
          <CardContent className="p-6">
            <div className="flex items-center gap-4">
              <div className="h-12 w-12 rounded-xl bg-purple-50 dark:bg-purple-900/20 flex items-center justify-center text-purple-600 dark:text-purple-400">
                <UsersIcon className="h-6 w-6" />
              </div>
              <div>
                <p className="text-sm font-medium text-slate-500 dark:text-slate-400">Total Users</p>
                <p className="text-3xl font-bold text-slate-900 dark:text-slate-100">{counts.users}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm hover:shadow-md transition-shadow">
          <CardContent className="p-6">
            <div className="flex items-center gap-4">
              <div className="h-12 w-12 rounded-xl bg-emerald-50 dark:bg-emerald-900/20 flex items-center justify-center text-emerald-600 dark:text-emerald-400">
                <Sparkles className="h-6 w-6" />
              </div>
              <div>
                <p className="text-sm font-medium text-slate-500 dark:text-slate-400">Active Workspaces</p>
                <p className="text-3xl font-bold text-slate-900 dark:text-slate-100">{counts.activeWorkspaces}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
