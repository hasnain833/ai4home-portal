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
import { Loader2, Building2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";

interface CompanyRecord {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  warrantyEnabled: boolean;
  salesEnabled: boolean;
  verificationStatus: string;
  createdAt: string;
  _count?: {
    users: number;
    integrations: number;
  };
}

const verificationBadge = (status: string) => {
  switch (status) {
    case "VERIFIED":
      return "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400";
    case "SUBMITTED":
      return "bg-amber-500/15 text-amber-600 dark:text-amber-400";
    default:
      return "bg-zinc-500/15 text-zinc-500 dark:text-zinc-400";
  }
};

export default function AdminCompaniesPage() {
  const { user } = useAuth();
  const [companies, setCompanies] = useState<CompanyRecord[]>([]);
  const [loading, setLoading] = useState(true);

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

  useEffect(() => {
    if (user?.isSuperAdmin) fetchCompanies();
  }, [user]);

  return (
    <div className="space-y-6">
      <Card className="bg-card border-border shadow-sm">
        <CardHeader className="border-b border-border pb-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 bg-[#b48c3c]/10 rounded-lg flex items-center justify-center text-[#b48c3c]">
              <Building2 className="h-5 w-5" />
            </div>
            <div>
              <CardTitle className="text-xl text-foreground">Tenant Companies</CardTitle>
              <p className="text-sm text-muted-foreground mt-1">Details for every registered tenant. Manage workspace access from Users &amp; Access.</p>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader className="bg-muted/50">
                <TableRow>
                  <TableHead className="pl-6">Company</TableHead>
                  <TableHead>Contact</TableHead>
                  <TableHead>Address</TableHead>
                  <TableHead>Verification</TableHead>
                  <TableHead>Workspaces</TableHead>
                  <TableHead className="text-center">Users</TableHead>
                  <TableHead className="pr-6">Joined</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={7} className="py-12 text-center text-muted-foreground">
                      <Loader2 className="h-5 w-5 animate-spin mx-auto mb-2" />
                      Loading companies...
                    </TableCell>
                  </TableRow>
                ) : companies.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="py-12 text-center text-muted-foreground">No companies found.</TableCell>
                  </TableRow>
                ) : (
                  companies.map((company) => (
                    <TableRow key={company.id} className="hover:bg-muted/40">
                      <TableCell className="pl-6 font-medium text-foreground">{company.name}</TableCell>
                      <TableCell>
                        <div className="flex flex-col text-sm text-muted-foreground">
                          <span>{company.email || "—"}</span>
                          <span className="text-xs">{company.phone || "—"}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground max-w-[220px] truncate">
                        {company.address || "—"}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={`border-0 uppercase text-[10px] tracking-wider font-bold ${verificationBadge(company.verificationStatus)}`}>
                          {company.verificationStatus || "PENDING"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1.5">
                          <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-medium ${company.warrantyEnabled ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" : "bg-zinc-500/10 text-muted-foreground line-through"}`}>
                            Warranty
                          </span>
                          <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-medium ${company.salesEnabled ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" : "bg-zinc-500/10 text-muted-foreground line-through"}`}>
                            Sales
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="text-center text-sm text-foreground/80">
                        {company._count?.users ?? "—"}
                      </TableCell>
                      <TableCell className="pr-6 text-sm text-muted-foreground whitespace-nowrap">
                        {company.createdAt ? new Date(company.createdAt).toLocaleDateString() : "—"}
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
