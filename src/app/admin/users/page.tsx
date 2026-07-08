"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Loader2, Users } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";

interface UserRecord {
  id: string;
  name: string | null;
  email: string;
  role: string;
  isSuperAdmin: boolean;
  companyName: string;
  hasWarrantyAccess: boolean;
  hasSalesAccess: boolean;
  accountStatus: string;
}

export default function AdminUsersPage() {
  const { user } = useAuth();
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);

  useEffect(() => {
    if (user?.isSuperAdmin) fetchUsers();
  }, [user]);

  const fetchUsers = async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/admin/users");
      const data = await response.json();
      if (response.ok) setUsers(data);
    } finally {
      setLoading(false);
    }
  };

  const handleToggle = (userId: string, field: "hasWarrantyAccess" | "hasSalesAccess") => {
    setUsers(current => current.map(u => u.id === userId ? { ...u, [field]: !u[field] } : u));
  };

  const handleSave = async (userRecord: UserRecord) => {
    setSavingId(userRecord.id);
    try {
      await fetch(`/api/admin/users/${userRecord.id}/access`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          hasWarrantyAccess: userRecord.hasWarrantyAccess,
          hasSalesAccess: userRecord.hasSalesAccess,
        }),
      });
      await fetchUsers();
    } finally {
      setSavingId(null);
    }
  };

  const getRoleBadgeColor = (role: string, isSuperAdmin: boolean) => {
    if (isSuperAdmin) return "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300";
    if (role === "admin") return "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300";
    if (role === "staff") return "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300";
    return "bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-300";
  };

  return (
    <div className="space-y-6">
      <Card className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm">
        <CardHeader className="border-b border-slate-100 dark:border-slate-800 pb-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 bg-purple-50 dark:bg-purple-900/20 rounded-lg flex items-center justify-center text-purple-600 dark:text-purple-400">
              <Users className="h-5 w-5" />
            </div>
            <div>
              <CardTitle className="text-xl">Users & Access Controls</CardTitle>
              <p className="text-sm text-slate-500 mt-1">Manage individual workspace permissions across admins, staff, and homeowners.</p>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader className="bg-slate-50 dark:bg-slate-950/50">
                <TableRow>
                  <TableHead className="pl-6">User</TableHead>
                  <TableHead>Company</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Access Level</TableHead>
                  <TableHead className="text-right pr-6">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={6} className="py-12 text-center text-slate-500">
                      <Loader2 className="h-5 w-5 animate-spin mx-auto mb-2" />
                      Loading users...
                    </TableCell>
                  </TableRow>
                ) : users.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="py-12 text-center text-slate-500">No users found.</TableCell>
                  </TableRow>
                ) : (
                  users.map((u) => (
                    <TableRow key={u.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/20">
                      <TableCell className="pl-6">
                        <div className="flex flex-col">
                          <span className="font-medium text-slate-900 dark:text-slate-100">{u.name || "—"}</span>
                          <span className="text-xs text-slate-500">{u.email}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-slate-600 dark:text-slate-300">{u.companyName}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={`border-0 uppercase text-[10px] tracking-wider font-bold ${getRoleBadgeColor(u.role, u.isSuperAdmin)}`}>
                          {u.isSuperAdmin ? "Super Admin" : u.role}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant={u.accountStatus === "Active" ? "default" : u.accountStatus === "Super Admin" ? "secondary" : "outline"}>
                          {u.accountStatus}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-4">
                          <label className={`flex items-center gap-2 ${u.isSuperAdmin ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}>
                            <Checkbox
                              checked={u.hasWarrantyAccess}
                              disabled={u.isSuperAdmin}
                              onCheckedChange={() => handleToggle(u.id, "hasWarrantyAccess")}
                            />
                            <span className="text-sm font-medium">Warranty</span>
                          </label>
                          <label className={`flex items-center gap-2 ${u.isSuperAdmin ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}>
                            <Checkbox
                              checked={u.hasSalesAccess}
                              disabled={u.isSuperAdmin}
                              onCheckedChange={() => handleToggle(u.id, "hasSalesAccess")}
                            />
                            <span className="text-sm font-medium">Sales</span>
                          </label>
                        </div>
                      </TableCell>
                      <TableCell className="text-right pr-6">
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => handleSave(u)}
                          disabled={savingId === u.id || u.isSuperAdmin}
                        >
                          {savingId === u.id ? "Saving..." : "Save"}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
