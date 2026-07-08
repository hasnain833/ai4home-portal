"use client";

import { useEffect, useState } from "react";
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
import { Button } from "@/components/ui/button";
import { Loader2, Building2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";

interface CompanyRecord {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  warrantyEnabled: boolean;
  salesEnabled: boolean;
}

export default function AdminCompaniesPage() {
  const { user } = useAuth();
  const [companies, setCompanies] = useState<CompanyRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);

  useEffect(() => {
    if (user?.isSuperAdmin) fetchCompanies();
  }, [user]);

  const fetchCompanies = async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/admin/companies");
      const data = await response.json();
      if (response.ok) setCompanies(data);
    } finally {
      setLoading(false);
    }
  };

  const handleToggle = (companyId: string, field: "warrantyEnabled" | "salesEnabled") => {
    setCompanies(current => current.map(c => c.id === companyId ? { ...c, [field]: !c[field] } : c));
  };

  const handleSave = async (company: CompanyRecord) => {
    setSavingId(company.id);
    try {
      await fetch(`/api/admin/companies/${company.id}/workspaces`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          warrantyEnabled: company.warrantyEnabled,
          salesEnabled: company.salesEnabled,
        }),
      });
      await fetchCompanies();
    } finally {
      setSavingId(null);
    }
  };

  return (
    <div className="space-y-6">
      <Card className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm">
        <CardHeader className="border-b border-slate-100 dark:border-slate-800 pb-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 bg-blue-50 dark:bg-blue-900/20 rounded-lg flex items-center justify-center text-blue-600 dark:text-blue-400">
              <Building2 className="h-5 w-5" />
            </div>
            <div>
              <CardTitle className="text-xl">Tenant Companies</CardTitle>
              <p className="text-sm text-slate-500 mt-1">Manage global workspace enablement across all registered tenants.</p>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader className="bg-slate-50 dark:bg-slate-950/50">
                <TableRow>
                  <TableHead className="pl-6">Company</TableHead>
                  <TableHead>Contact</TableHead>
                  <TableHead>Warranty Workspace</TableHead>
                  <TableHead>Sales Workspace</TableHead>
                  <TableHead className="text-right pr-6">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={5} className="py-12 text-center text-slate-500">
                      <Loader2 className="h-5 w-5 animate-spin mx-auto mb-2" />
                      Loading companies...
                    </TableCell>
                  </TableRow>
                ) : companies.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="py-12 text-center text-slate-500">No companies found.</TableCell>
                  </TableRow>
                ) : (
                  companies.map((company) => (
                    <TableRow key={company.id}>
                      <TableCell className="pl-6 font-medium text-slate-900 dark:text-slate-100">{company.name}</TableCell>
                      <TableCell>
                        <div className="flex flex-col text-sm text-slate-600 dark:text-slate-400">
                          <span>{company.email || "—"}</span>
                          <span className="text-xs">{company.phone || "—"}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <label className="flex items-center gap-2 cursor-pointer">
                          <Checkbox
                            checked={company.warrantyEnabled}
                            onCheckedChange={() => handleToggle(company.id, "warrantyEnabled")}
                          />
                          <span className="text-sm text-slate-700 dark:text-slate-300">Enabled</span>
                        </label>
                      </TableCell>
                      <TableCell>
                        <label className="flex items-center gap-2 cursor-pointer">
                          <Checkbox
                            checked={company.salesEnabled}
                            onCheckedChange={() => handleToggle(company.id, "salesEnabled")}
                          />
                          <span className="text-sm text-slate-700 dark:text-slate-300">Enabled</span>
                        </label>
                      </TableCell>
                      <TableCell className="text-right pr-6">
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => handleSave(company)}
                          disabled={savingId === company.id}
                        >
                          {savingId === company.id ? "Saving..." : "Save Changes"}
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
