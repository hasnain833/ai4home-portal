"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowRight,
  Building2,
  CheckCircle2,
  Mail,
  RefreshCw,
  ShieldCheck,
  ShoppingBag,
  Wrench,
} from "lucide-react";
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
import { useAuth } from "@/contexts/AuthContext";

interface CompanyOverview {
  id: string;
  name: string;
  email: string | null;
  verificationStatus: string;
  warrantyEnabled: boolean;
  salesEnabled: boolean;
}

interface MessagingOverview {
  emailSender: { configured: boolean; sendingAddress: string };
  failures: { categories: { attempts: number }[] };
}

export default function SuperAdminOverviewPage() {
  const { user, isLoading } = useAuth();
  const router = useRouter();
  const [companies, setCompanies] = useState<CompanyOverview[]>([]);
  const [messaging, setMessaging] = useState<MessagingOverview | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isLoading && !user) {
      router.push("/login");
      return;
    }
    if (!isLoading && user && !user.isSuperAdmin) router.push("/");
  }, [user, isLoading, router]);

  useEffect(() => {
    if (!user?.isSuperAdmin) return;

    const fetchOverview = async () => {
      setLoading(true);
      try {
        const [companiesResponse, messagingResponse] = await Promise.all([
          fetch("/api/admin/companies"),
          fetch("/api/admin/messaging/spend"),
        ]);
        if (companiesResponse.ok) setCompanies(await companiesResponse.json());
        if (messagingResponse.ok) setMessaging(await messagingResponse.json());
      } catch (error) {
        console.error("Failed to load super admin overview:", error);
      } finally {
        setLoading(false);
      }
    };

    void fetchOverview();
  }, [user]);

  const stats = useMemo(() => {
    const verified = companies.filter((company) => company.verificationStatus === "VERIFIED").length;
    const warranty = companies.filter((company) => company.warrantyEnabled).length;
    const sales = companies.filter((company) => company.salesEnabled).length;
    const failures = messaging?.failures.categories.reduce(
      (sum, category) => sum + category.attempts,
      0,
    ) ?? 0;
    return { verified, warranty, sales, failures };
  }, [companies, messaging]);

  if (loading) {
    return <div className="p-8 text-center text-muted-foreground">Loading overview...</div>;
  }

  const metricCards = [
    { label: "Tenant companies", value: companies.length, icon: Building2 },
    { label: "Verified tenants", value: stats.verified, icon: ShieldCheck },
    { label: "Warranty enabled", value: stats.warranty, icon: Wrench },
    { label: "Sales enabled", value: stats.sales, icon: ShoppingBag },
  ];

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-4 md:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase text-[#b48c3c]">Platform operations</p>
          <h1 className="mt-1 text-2xl font-bold md:text-3xl">Super Admin Overview</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Tenant access, workspace coverage, and messaging health in one place.
          </p>
        </div>
        <Button variant="outline" asChild className="gap-2">
          <Link href="/admin/companies">
            Manage companies <ArrowRight className="h-4 w-4" />
          </Link>
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {metricCards.map(({ label, value, icon: Icon }) => (
          <Card key={label} className="shadow-sm">
            <CardContent className="flex items-center justify-between p-5">
              <div>
                <p className="text-sm font-medium text-muted-foreground">{label}</p>
                <p className="mt-1 text-3xl font-bold">{value}</p>
              </div>
              <div className="flex h-10 w-10 items-center justify-center rounded-md bg-[#b48c3c]/10 text-[#b48c3c]">
                <Icon className="h-5 w-5" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.7fr)_minmax(280px,1fr)]">
        <Card className="shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-base">Workspace coverage</CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">Current access by tenant.</p>
            </div>
            <Button variant="ghost" size="sm" asChild>
              <Link href="/admin/companies">View all</Link>
            </Button>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Tenant</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Warranty</TableHead>
                    <TableHead>Sales</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {companies.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="py-10 text-center text-muted-foreground">
                        No tenant companies found.
                      </TableCell>
                    </TableRow>
                  ) : (
                    companies.slice(0, 6).map((company) => (
                      <TableRow key={company.id}>
                        <TableCell>
                          <p className="font-medium">{company.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {company.email || "No contact email"}
                          </p>
                        </TableCell>
                        <TableCell>
                          <Badge variant={company.verificationStatus === "VERIFIED" ? "default" : "secondary"}>
                            {company.verificationStatus.toLowerCase()}
                          </Badge>
                        </TableCell>
                        <TableCell>{company.warrantyEnabled ? "Enabled" : "Off"}</TableCell>
                        <TableCell>{company.salesEnabled ? "Enabled" : "Off"}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card className="shadow-sm">
            <CardHeader>
              <CardTitle className="text-base">Messaging health</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-start gap-3">
                <Mail className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0">
                  <p className="text-sm font-medium">Email sender</p>
                  <p className="truncate font-mono text-xs text-muted-foreground">
                    {messaging?.emailSender.sendingAddress || "Not configured"}
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                {stats.failures > 0 ? (
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                ) : (
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                )}
                <div>
                  <p className="text-sm font-medium">Delivery failures</p>
                  <p className="text-xs text-muted-foreground">
                    {stats.failures > 0 ? `${stats.failures} attempts need review` : "No failures recorded"}
                  </p>
                </div>
              </div>
              <Button variant="outline" size="sm" asChild className="w-full gap-2">
                <Link href="/admin/messaging">
                  Review messaging <RefreshCw className="h-3.5 w-3.5" />
                </Link>
              </Button>
            </CardContent>
          </Card>

          <Card className="shadow-sm">
            <CardHeader>
              <CardTitle className="text-base">Admin session</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm font-medium">{user?.name || user?.email}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Super administrator access active
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
