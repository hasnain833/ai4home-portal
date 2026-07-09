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
  companyId: string | null;
  companyName: string;
  // Company-level workspace enablement (tenant purchased the workspace).
  warrantyEnabled: boolean;
  salesEnabled: boolean;
  accountStatus: string;
}

export default function AdminUsersPage() {
  const { user } = useAuth();
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);

  const fetchUsers = async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/admin/users");
      const data = await response.json();
      // Only tenant admins are managed here — staff and homeowners inherit
      // access from their company/admin, so they are not shown.
      if (response.ok) setUsers((data as UserRecord[]).filter((u) => u.role === "ADMIN"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (user?.isSuperAdmin) fetchUsers();
  }, [user]);

  const toggleCompany = (userId: string, field: "warrantyEnabled" | "salesEnabled") => {
    setUsers(current => current.map(u => u.id === userId ? { ...u, [field]: !u[field] } : u));
  };

  const handleSave = async (u: UserRecord) => {
    if (!u.companyId) return;
    setSavingId(u.id);
    try {
      await fetch(`/api/admin/companies/${u.companyId}/workspaces`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          warrantyEnabled: u.warrantyEnabled,
          salesEnabled: u.salesEnabled,
        }),
      });
      await fetchUsers();
    } finally {
      setSavingId(null);
    }
  };

  return (
    <div className="space-y-6">
      <Card className="bg-card border-border shadow-sm">
        <CardHeader className="border-b border-border pb-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 bg-[#b48c3c]/10 rounded-lg flex items-center justify-center text-[#b48c3c]">
              <Users className="h-5 w-5" />
            </div>
            <div>
              <CardTitle className="text-xl text-foreground">Users &amp; Access Controls</CardTitle>
              <p className="text-sm text-muted-foreground mt-1">Enable the workspaces each tenant has purchased. Staff and homeowners inherit access from their company.</p>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader className="bg-muted/50">
                <TableRow>
                  <TableHead className="pl-6">User</TableHead>
                  <TableHead>Company</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Workspace Enablement</TableHead>
                  <TableHead className="text-right pr-6">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={6} className="py-12 text-center text-muted-foreground">
                      <Loader2 className="h-5 w-5 animate-spin mx-auto mb-2" />
                      Loading admins...
                    </TableCell>
                  </TableRow>
                ) : users.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="py-12 text-center text-muted-foreground">No tenant admins found.</TableCell>
                  </TableRow>
                ) : (
                  users.map((u) => (
                    <TableRow key={u.id} className="hover:bg-muted/40">
                      <TableCell className="pl-6">
                        <div className="flex flex-col">
                          <span className="font-medium text-foreground">{u.name || "—"}</span>
                          <span className="text-xs text-muted-foreground">{u.email}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{u.companyName}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="border-0 uppercase text-[10px] tracking-wider font-bold bg-[#b48c3c]/15 text-[#b48c3c]">
                          {u.role}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant={u.accountStatus === "Active" ? "default" : u.accountStatus === "Super Admin" ? "secondary" : "outline"}>
                          {u.accountStatus}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-4">
                          <label className={`flex items-center gap-2 ${u.isSuperAdmin || !u.companyId ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}>
                            <Checkbox
                              checked={u.warrantyEnabled}
                              disabled={u.isSuperAdmin || !u.companyId}
                              onCheckedChange={() => toggleCompany(u.id, "warrantyEnabled")}
                            />
                            <span className="text-sm font-medium">Warranty</span>
                          </label>
                          <label className={`flex items-center gap-2 ${u.isSuperAdmin || !u.companyId ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}>
                            <Checkbox
                              checked={u.salesEnabled}
                              disabled={u.isSuperAdmin || !u.companyId}
                              onCheckedChange={() => toggleCompany(u.id, "salesEnabled")}
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
