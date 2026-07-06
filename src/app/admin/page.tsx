"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Loader2,
  Building2,
  ShieldCheck,
  ToggleRight,
  Sparkles,
  Users,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";

interface CompanyRecord {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  warrantyEnabled: boolean;
  salesEnabled: boolean;
  createdAt: string;
  _count: {
    users: number;
    integrations: number;
  };
}

interface UserRecord {
  id: string;
  name: string | null;
  email: string;
  role: string;
  isSuperAdmin: boolean;
  companyName: string;
  warrantyEnabled: boolean;
  salesEnabled: boolean;
  hasWarrantyAccess: boolean;
  hasSalesAccess: boolean;
  lastActiveWorkspace: string | null;
  createdAt: string;
  accountStatus: string;
}

export default function SuperAdminPage() {
  const { user, isLoading } = useAuth();
  const router = useRouter();
  const [companies, setCompanies] = useState<CompanyRecord[]>([]);
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [activeTab, setActiveTab] = useState<"tenants" | "users">("tenants");
  const [loadingCompanies, setLoadingCompanies] = useState(true);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [savingUserId, setSavingUserId] = useState<string | null>(null);

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
    if (!isLoading && user?.isSuperAdmin) {
      fetchCompanies();
      fetchUsers();
    }
  }, [user, isLoading]);

  const fetchCompanies = async () => {
    setLoadingCompanies(true);
    try {
      const response = await fetch("/api/admin/companies");
      if (!response.ok) {
        throw new Error("Unauthorized");
      }
      const data = await response.json();
      setCompanies(data);
    } catch (error) {
      console.error("Failed to load companies:", error);
    } finally {
      setLoadingCompanies(false);
    }
  };

  const fetchUsers = async () => {
    setLoadingUsers(true);
    try {
      const response = await fetch("/api/admin/users");
      if (!response.ok) {
        throw new Error("Unauthorized");
      }
      const data = await response.json();
      setUsers(data);
    } catch (error) {
      console.error("Failed to load users:", error);
    } finally {
      setLoadingUsers(false);
    }
  };

  const handleToggle = (
    companyId: string,
    field: "warrantyEnabled" | "salesEnabled",
  ) => {
    setCompanies((current) =>
      current.map((company) =>
        company.id === companyId
          ? { ...company, [field]: !company[field] }
          : company,
      ),
    );
  };

  const handleSave = async (company: CompanyRecord) => {
    setSavingId(company.id);
    try {
      const response = await fetch(
        `/api/admin/companies/${company.id}/workspaces`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            warrantyEnabled: company.warrantyEnabled,
            salesEnabled: company.salesEnabled,
          }),
        },
      );
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.message || "Failed to save workspace settings");
      }
      await fetchCompanies();
    } catch (error) {
      console.error(error);
    } finally {
      setSavingId(null);
    }
  };

  const handleUserToggle = (userId: string, field: "hasWarrantyAccess" | "hasSalesAccess") => {
    setUsers((current) =>
      current.map((u) => (u.id === userId ? { ...u, [field]: !u[field] } : u))
    );
  };

  const handleUserSave = async (userRecord: UserRecord) => {
    setSavingUserId(userRecord.id);
    try {
      const response = await fetch(`/api/admin/users/${userRecord.id}/access`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          hasWarrantyAccess: userRecord.hasWarrantyAccess,
          hasSalesAccess: userRecord.hasSalesAccess,
        }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.message || "Failed to save user access");
      }
      await fetchUsers();
    } catch (error) {
      console.error(error);
    } finally {
      setSavingUserId(null);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 py-10 px-4 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <Card className="overflow-hidden bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
          <CardHeader>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="inline-flex items-center gap-2 text-[#0F3B3D] dark:text-[#b48c3c] mb-2">
                  <ShieldCheck className="h-5 w-5" />
                  <CardTitle className="text-2xl font-semibold">
                    Super Admin Dashboard
                  </CardTitle>
                </div>
                <p className="max-w-2xl text-sm text-slate-500 dark:text-slate-400">
                  Manage tenant workspace access, review user accounts, and keep
                  the entire portal secure from one central place.
                </p>
              </div>
              <div className="rounded-3xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 p-4">
                <p className="text-xs uppercase tracking-[0.3em] text-slate-500 dark:text-slate-400">
                  Signed in as
                </p>
                <p className="mt-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
                  {user?.name || user?.email}
                </p>
                <p className="text-xs text-slate-600 dark:text-slate-400">
                  Super Admin account
                </p>
              </div>
            </div>
          </CardHeader>
        </Card>

        <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
          <div className="space-y-6">
            <Card className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
              <CardHeader>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <CardTitle className="text-lg">Portal controls</CardTitle>
                    <p className="text-sm text-slate-500 dark:text-slate-400">
                      Use the tabs to switch between tenant workspace and user
                      management.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant={
                        activeTab === "tenants" ? "secondary" : "outline"
                      }
                      size="sm"
                      onClick={() => setActiveTab("tenants")}
                    >
                      Tenant controls
                    </Button>
                    <Button
                      variant={activeTab === "users" ? "secondary" : "outline"}
                      size="sm"
                      onClick={() => setActiveTab("users")}
                    >
                      User directory
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="grid gap-4 sm:grid-cols-3">
                  <div className="rounded-3xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 p-4">
                    <p className="text-sm text-slate-500 dark:text-slate-400">
                      Tenant companies
                    </p>
                    <p className="mt-3 text-3xl font-semibold text-slate-900 dark:text-slate-100">
                      {companies.length}
                    </p>
                  </div>
                  <div className="rounded-3xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 p-4">
                    <p className="text-sm text-slate-500 dark:text-slate-400">
                      Total users
                    </p>
                    <p className="mt-3 text-3xl font-semibold text-slate-900 dark:text-slate-100">
                      {users.length}
                    </p>
                  </div>
                  <div className="rounded-3xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 p-4">
                    <p className="text-sm text-slate-500 dark:text-slate-400">
                      Active workspaces
                    </p>
                    <p className="mt-3 text-3xl font-semibold text-slate-900 dark:text-slate-100">
                      {
                        companies.filter(
                          (company) =>
                            company.warrantyEnabled || company.salesEnabled,
                        ).length
                      }
                    </p>
                  </div>
                </div>

                {activeTab === "tenants" ? (
                  <section className="space-y-4">
                    <div className="rounded-3xl border border-slate-200 dark:border-slate-800 overflow-hidden">
                      <div className="bg-slate-50 dark:bg-slate-950 px-6 py-5 flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2 text-slate-700 dark:text-slate-200">
                          <Building2 className="h-5 w-5" />
                          <span className="text-sm font-semibold">
                            Tenant workspace management
                          </span>
                        </div>
                        <span className="text-xs text-slate-500 dark:text-slate-400">
                          Enable or disable entire workspaces for each tenant.
                        </span>
                      </div>

                      <div className="overflow-x-auto">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Company</TableHead>
                              <TableHead>Contact</TableHead>
                              <TableHead>Warranty</TableHead>
                              <TableHead>Sales</TableHead>
                              <TableHead className="text-right">
                                Actions
                              </TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {loadingCompanies ? (
                              <TableRow>
                                <TableCell
                                  colSpan={5}
                                  className="py-10 text-center"
                                >
                                  <div className="inline-flex items-center gap-3 text-slate-500 dark:text-slate-400">
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                    Loading tenant companies...
                                  </div>
                                </TableCell>
                              </TableRow>
                            ) : companies.length === 0 ? (
                              <TableRow>
                                <TableCell
                                  colSpan={5}
                                  className="py-10 text-center text-slate-500 dark:text-slate-400"
                                >
                                  No tenant companies available.
                                </TableCell>
                              </TableRow>
                            ) : (
                              companies.map((company) => (
                                <TableRow key={company.id}>
                                  <TableCell className="font-medium">
                                    {company.name}
                                  </TableCell>
                                  <TableCell>
                                    <div className="flex flex-col gap-1 text-sm text-slate-600 dark:text-slate-300">
                                      <span>{company.email || "—"}</span>
                                      <span>{company.phone || "—"}</span>
                                    </div>
                                  </TableCell>
                                  <TableCell>
                                    <div className="flex items-center gap-2">
                                      <Checkbox
                                        checked={company.warrantyEnabled}
                                        onCheckedChange={() =>
                                          handleToggle(
                                            company.id,
                                            "warrantyEnabled",
                                          )
                                        }
                                      />
                                      <span className="text-sm">Enabled</span>
                                    </div>
                                  </TableCell>
                                  <TableCell>
                                    <div className="flex items-center gap-2">
                                      <Checkbox
                                        checked={company.salesEnabled}
                                        onCheckedChange={() =>
                                          handleToggle(
                                            company.id,
                                            "salesEnabled",
                                          )
                                        }
                                      />
                                      <span className="text-sm">Enabled</span>
                                    </div>
                                  </TableCell>
                                  <TableCell className="text-right">
                                    <Button
                                      size="sm"
                                      variant="secondary"
                                      onClick={() => handleSave(company)}
                                      disabled={savingId === company.id}
                                    >
                                      {savingId === company.id
                                        ? "Saving..."
                                        : "Save"}
                                    </Button>
                                  </TableCell>
                                </TableRow>
                              ))
                            )}
                          </TableBody>
                        </Table>
                      </div>
                    </div>
                  </section>
                ) : (
                  <section className="space-y-4">
                    <div className="rounded-3xl border border-slate-200 dark:border-slate-800 overflow-hidden">
                      <div className="bg-slate-50 dark:bg-slate-950 px-6 py-5 flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2 text-slate-700 dark:text-slate-200">
                          <Users className="h-5 w-5" />
                          <span className="text-sm font-semibold">
                            Tenant user directory
                          </span>
                        </div>
                        <span className="text-xs text-slate-500 dark:text-slate-400">
                          Review roles, workspace access and account status.
                        </span>
                      </div>

                      <div className="overflow-x-auto">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Name</TableHead>
                              <TableHead>Email</TableHead>
                              <TableHead>Role</TableHead>
                              <TableHead>Company</TableHead>
                              <TableHead>Status</TableHead>
                              <TableHead>Workspaces</TableHead>
                              <TableHead className="text-right">Actions</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {loadingUsers ? (
                              <TableRow>
                                <TableCell
                                  colSpan={7}
                                  className="py-10 text-center"
                                >
                                  <div className="inline-flex items-center gap-3 text-slate-500 dark:text-slate-400">
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                    Loading users...
                                  </div>
                                </TableCell>
                              </TableRow>
                            ) : users.length === 0 ? (
                              <TableRow>
                                <TableCell
                                  colSpan={7}
                                  className="py-10 text-center text-slate-500 dark:text-slate-400"
                                >
                                  No users found.
                                </TableCell>
                              </TableRow>
                            ) : (
                              users.map((userRecord) => (
                                <TableRow key={userRecord.id}>
                                  <TableCell className="font-medium">
                                    {userRecord.name || "—"}
                                  </TableCell>
                                  <TableCell>{userRecord.email}</TableCell>
                                  <TableCell>
                                    <Badge
                                      variant="secondary"
                                      className="uppercase"
                                    >
                                      {userRecord.isSuperAdmin
                                        ? "Super Admin"
                                        : userRecord.role.toLowerCase()}
                                    </Badge>
                                  </TableCell>
                                  <TableCell>
                                    {userRecord.companyName}
                                  </TableCell>
                                  <TableCell>
                                    <Badge
                                      variant={
                                        userRecord.accountStatus === "Active"
                                          ? "default"
                                          : userRecord.accountStatus ===
                                              "Super Admin"
                                            ? "secondary"
                                            : "outline"
                                      }
                                    >
                                      {userRecord.accountStatus}
                                    </Badge>
                                  </TableCell>
                                  <TableCell>
                                    <div className="flex items-center gap-4">
                                      <label className="flex items-center gap-2 cursor-pointer">
                                        <Checkbox
                                          checked={userRecord.hasWarrantyAccess}
                                          disabled={userRecord.isSuperAdmin}
                                          onCheckedChange={() =>
                                            handleUserToggle(userRecord.id, "hasWarrantyAccess")
                                          }
                                        />
                                        <span className="text-sm">Warranty</span>
                                      </label>
                                      <label className="flex items-center gap-2 cursor-pointer">
                                        <Checkbox
                                          checked={userRecord.hasSalesAccess}
                                          disabled={userRecord.isSuperAdmin}
                                          onCheckedChange={() =>
                                            handleUserToggle(userRecord.id, "hasSalesAccess")
                                          }
                                        />
                                        <span className="text-sm">Sales</span>
                                      </label>
                                    </div>
                                  </TableCell>
                                  <TableCell className="text-right">
                                    <Button
                                      size="sm"
                                      variant="secondary"
                                      onClick={() => handleUserSave(userRecord)}
                                      disabled={savingUserId === userRecord.id || userRecord.isSuperAdmin}
                                    >
                                      {savingUserId === userRecord.id ? "Saving..." : "Save"}
                                    </Button>
                                  </TableCell>
                                </TableRow>
                              ))
                            )}
                          </TableBody>
                        </Table>
                      </div>
                    </div>
                  </section>
                )}
              </CardContent>
            </Card>
          </div>

          <aside className="space-y-6">
            <Card className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
              <CardHeader>
                <div className="flex items-center gap-2 text-slate-900 dark:text-slate-100">
                  <Sparkles className="h-5 w-5" />
                  <CardTitle className="text-base">Quick facts</CardTitle>
                </div>
              </CardHeader>
              <CardContent className="space-y-4 text-sm text-slate-600 dark:text-slate-300">
                <div>
                  <p className="font-semibold text-slate-900 dark:text-slate-100">
                    Super Admin access
                  </p>
                  <p>
                    Full access to every tenant and workspace in the portal.
                  </p>
                </div>
                <div>
                  <p className="font-semibold text-slate-900 dark:text-slate-100">
                    Workspace controls
                  </p>
                  <p>
                    Disabling a workspace here immediately affects all users in
                    that company.
                  </p>
                </div>
                <div>
                  <p className="font-semibold text-slate-900 dark:text-slate-100">
                    User details
                  </p>
                  <p>
                    Each row shows role, tenant, and access flags so you can
                    audit who can use what.
                  </p>
                </div>
              </CardContent>
            </Card>
          </aside>
        </div>
      </div>
    </div>
  );
}
