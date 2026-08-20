"use client";

import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { statusColor } from "@/lib/lead-statuses";
import { Users, CalendarDays, Plus, ArrowRight, Sparkles } from "lucide-react";

/**
 * The homeowner's view of the Sales workspace.
 *
 * Deliberately not the builder dashboard with the numbers filtered out: a
 * homeowner has no CRM, no campaigns and no appointments, so cards like "Model
 * Home Bookings" or "Avg Lead Conversion" would sit at zero forever and read as
 * broken rather than empty. This shows only what they actually own.
 */

type RecentLead = {
  id: string;
  name: string;
  status: string;
  source: string;
  date: string;
};

type CalendarItem = {
  id: string;
  title: string;
  scheduledAt: string;
  status: string;
};

export type HomeownerDashboardProps = {
  loading: boolean;
  leadCounts: { total: number; new: number; nurturing: number };
  recentLeads: RecentLead[];
  calendarItems: CalendarItem[];
};

const METRICS = [
  { key: "total", label: "My Leads", hint: "Prospects you own" },
  { key: "new", label: "New", hint: "Not yet contacted" },
  { key: "nurturing", label: "Nurturing", hint: "Conversation in progress" },
] as const;

export default function HomeownerDashboard({
  loading,
  leadCounts,
  recentLeads,
  calendarItems,
}: HomeownerDashboardProps) {
  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight">My Sales Workspace</h1>
          <p className="text-muted-foreground text-sm mt-1">
            The prospects you own, and what is scheduled next.
          </p>
        </div>
        <Button asChild className="bg-[#0F3B3D] hover:bg-[#0F3B3D]/90 gap-2 h-9">
          <Link href="/sales/leads">
            <Plus className="h-4 w-4" /> Add a lead
          </Link>
        </Button>
      </div>

      <div className="grid gap-4 grid-cols-1 sm:grid-cols-3">
        {METRICS.map((m) => (
          <Card key={m.key} className="border border-border/80 shadow-xs">
            <CardContent className="pt-5">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-muted-foreground">{m.label}</p>
                <Users className="h-4 w-4 text-[#b48c3c]" />
              </div>
              {loading ? (
                <Skeleton className="h-9 w-16 mt-2" />
              ) : (
                <p className="text-3xl font-bold mt-2 tabular-nums">{leadCounts[m.key]}</p>
              )}
              <p className="text-xs text-muted-foreground mt-1">{m.hint}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="border border-border/80 shadow-xs lg:col-span-2">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">My recent leads</CardTitle>
            <CardDescription className="text-xs">
              The five most recently added prospects you own.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="space-y-2">
                {[1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            ) : recentLeads.length === 0 ? (
              <div className="text-center py-10 text-muted-foreground">
                <Users className="h-10 w-10 mx-auto opacity-20 mb-3 text-[#b48c3c]" />
                <p className="text-sm font-semibold">You have no leads yet.</p>
                <p className="text-xs mt-1">
                  Add one by hand, or import a list from the Leads page.
                </p>
                <Button asChild variant="outline" size="sm" className="mt-4 gap-1.5 h-8 text-xs">
                  <Link href="/sales/leads">
                    Go to Leads <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                </Button>
              </div>
            ) : (
              <ul className="divide-y divide-border/50">
                {recentLeads.map((lead) => (
                  <li key={lead.id} className="flex items-center justify-between gap-3 py-2.5">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold truncate">{lead.name}</p>
                      <p className="text-[11px] text-muted-foreground">
                        Added {new Date(lead.date).toLocaleDateString()}
                      </p>
                    </div>
                    <Badge variant="secondary" className={`shrink-0 ${statusColor(lead.status)}`}>
                      {lead.status}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card className="border border-border/80 shadow-xs">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <CalendarDays className="h-4 w-4 text-[#b48c3c]" />
              Coming up
            </CardTitle>
            <CardDescription className="text-xs">Your scheduled calendar items.</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-20 w-full" />
            ) : calendarItems.length === 0 ? (
              <p className="py-8 text-center text-xs text-muted-foreground">
                Nothing scheduled.
              </p>
            ) : (
              <ul className="space-y-3">
                {calendarItems.map((item) => (
                  <li key={item.id} className="border-l-2 border-[#b48c3c] pl-3">
                    <p className="text-sm font-semibold leading-tight">{item.title}</p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      {new Date(item.scheduledAt).toLocaleString()}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="border border-border/80 shadow-xs bg-muted/20">
        <CardContent className="py-4 flex flex-wrap items-center gap-x-6 gap-y-2">
          <span className="flex items-center gap-2 text-sm font-semibold">
            <Sparkles className="h-4 w-4 text-[#b48c3c]" />
            Also available to you
          </span>
          <Link href="/sales/leads" className="text-xs text-muted-foreground hover:text-foreground">
            Leads &amp; CSV import
          </Link>
          <Link href="/sales/calendar" className="text-xs text-muted-foreground hover:text-foreground">
            Content Calendar
          </Link>
          <Link href="/sales/news" className="text-xs text-muted-foreground hover:text-foreground">
            News Feed
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
