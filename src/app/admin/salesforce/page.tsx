"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Check, Cloud, Loader2, RefreshCw, ShieldCheck, Unplug, X } from "lucide-react";
import { toast } from "sonner";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { apiFetch, errorMessage } from "@/lib/api";
import { B2B_LEAD_STATUSES, sendJson, titleCase } from "@/lib/b2b-store";

const API = "/api/admin/salesforce";
const NONE = "__none__";

type StatusMap = Record<string, string | null>;
interface Overview {
  available: boolean;
  connection: {
    instanceUrl: string;
    environment: string;
    identity: { user: string | null; username: string | null; org: string | null } | null;
    connectedAt: string;
    connectedBy: string | null;
    error: string | null;
  } | null;
  settings: { enabled: boolean; statusMap: StatusMap };
  lastRun: { at: string; status: string; message: string; errors: string[] } | null;
  pending: { leads: number; meetings: number; messages: number; deletions: number };
  logs: { id: string; status: string; message: string | null; createdAt: string }[];
}
interface Access {
  objects: { name: string; label: string; read: boolean; create: boolean; edit: boolean; delete: boolean; neededBySync: boolean; missing: string[] }[];
  ready: boolean;
  customFields: { name: string; label: string; type: string; note: string; present: boolean }[];
  leadStatuses: { value: string; label: string }[];
  suggestedStatusMap: StatusMap;
  apiCalls: { max: number; remaining: number } | null;
}

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
const RUN_STYLE: Record<string, string> = {
  SUCCESS: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  WARNING: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  ERROR: "bg-red-500/15 text-red-600 dark:text-red-400",
};

const Tick = ({ ok }: { ok: boolean }) =>
  ok ? <Check className="h-4 w-4 text-emerald-500" aria-label="Yes" /> : <X className="h-4 w-4 text-muted-foreground" aria-label="No" />;

/** Super Admin → Salesforce: AI4Home's own org, synced both ways with Business Leads. */
export default function SalesforcePage() {
  const confirm = useConfirm();
  const [data, setData] = useState<Overview | null>(null);
  const [access, setAccess] = useState<Access | null>(null);
  const [checking, setChecking] = useState(false);
  const [statusMap, setStatusMap] = useState<StatusMap>({});
  const [environment, setEnvironment] = useState("production");
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const next = await apiFetch<Overview>(API);
      setData(next);
      return next;
    } catch (e) {
      toast.error(errorMessage(e));
      return null;
    }
  }, []);

  const checkAccess = useCallback(async (saved: StatusMap) => {
    setChecking(true);
    try {
      const result = await apiFetch<Access>(`${API}/access`);
      setAccess(result);
      // Until a mapping is saved, start from the guess made from the org's own labels.
      setStatusMap(Object.values(saved).some(Boolean) ? saved : result.suggestedStatusMap);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("connected")) toast.success("Salesforce connected.");
    if (params.get("sf_error")) toast.error(`Salesforce: ${params.get("sf_error")}`);
    if (params.toString()) window.history.replaceState(null, "", window.location.pathname);
    apiFetch<Overview>(API)
      .then((d) => {
        setData(d);
        if (d.connection && !d.connection.error) checkAccess(d.settings.statusMap || {});
        else setStatusMap(d.settings.statusMap || {});
      })
      .catch((e) => toast.error(errorMessage(e)));
  }, [checkAccess]);

  const act = async (key: string, fn: () => Promise<unknown>, success?: string) => {
    setBusy(key);
    try {
      await fn();
      if (success) toast.success(success);
      await load();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const connect = () =>
    act("connect", async () => {
      const { url } = await sendJson<{ url: string }>(`${API}/connect`, "POST", { environment });
      window.location.href = url;
    });

  const disconnect = async () => {
    const ok = await confirm({
      title: "Disconnect Salesforce?",
      description: "The sync stops. Records already in Salesforce stay there, and the links are kept for when you reconnect.",
      confirmText: "Disconnect",
      destructive: true,
    });
    if (ok) await act("disconnect", () => sendJson(API, "DELETE"), "Salesforce disconnected.");
    setAccess(null);
  };

  const saveMapping = () => act("map", () => sendJson(`${API}/settings`, "PUT", { statusMap }), "Status mapping saved.");

  const setEnabled = async (enabled: boolean) => {
    if (enabled) {
      const ok = await confirm({
        title: "Start syncing with Salesforce?",
        description:
          "Every Business Lead is created or updated in Salesforce, with its meetings as Events and its conversation as Tasks. New and changed Salesforce Leads come into Business Leads. Deleting a lead on either side deletes it on the other, and deleting a demo's Event in Salesforce cancels that meeting. The first run can take a while.",
        confirmText: "Start sync",
      });
      if (!ok) return;
    }
    await act("enable", () => sendJson(`${API}/settings`, "PUT", { enabled, statusMap }), enabled ? "Sync started." : "Sync paused.");
  };

  const resync = async () => {
    const ok = await confirm({
      title: "Resync everything?",
      description: "Sends every lead and meeting again and re-reads all Salesforce Leads. Use it after changing the status mapping or adding the AI4HB fields.",
      confirmText: "Resync",
    });
    if (ok) await act("resync", () => sendJson(`${API}/resync`, "POST"), "Full resync started.");
  };

  if (!data) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const conn = data.connection;
  const enabled = data.settings.enabled;
  const mappingSaved = JSON.stringify(statusMap) === JSON.stringify(data.settings.statusMap || {});

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold">
          <Cloud className="h-6 w-6" /> Salesforce
        </h1>
        <p className="text-sm text-muted-foreground">
          AI4Home&apos;s own Salesforce org, kept in sync with Business Leads: details, status, opt-outs, booking link, meetings with their link and time, and the whole conversation. A lead deleted on either side is deleted on the other, and deleting a demo&apos;s Event in Salesforce cancels the meeting (Calendly tells the lead).
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Connection</CardTitle>
          <CardDescription>Sign in with a Salesforce user that can read and edit Leads, Events and Tasks. A dedicated integration user is safest.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!data.available && <p className="text-sm text-destructive">Salesforce isn&apos;t set up on this server (SALESFORCE_CLIENT_ID / SALESFORCE_CLIENT_SECRET).</p>}
          {conn ? (
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="space-y-1 text-sm">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{conn.identity?.org || conn.instanceUrl}</span>
                  <Badge variant="outline">{conn.environment === "production" ? "Production" : "Sandbox"}</Badge>
                  {conn.error ? <Badge variant="destructive">Needs reconnecting</Badge> : <Badge className={RUN_STYLE.SUCCESS}>Connected</Badge>}
                </div>
                <p className="text-muted-foreground">
                  As {conn.identity?.user || "unknown user"}
                  {conn.identity?.username ? ` (${conn.identity.username})` : ""} · {conn.instanceUrl}
                </p>
                <p className="text-muted-foreground">
                  Connected {when(conn.connectedAt)}
                  {conn.connectedBy ? ` by ${conn.connectedBy}` : ""}
                </p>
                {conn.error && <p className="text-destructive">{conn.error}</p>}
              </div>
              <Button variant="outline" onClick={disconnect} disabled={!!busy}>
                {busy === "disconnect" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Unplug className="mr-2 h-4 w-4" />}
                Disconnect
              </Button>
            </div>
          ) : (
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1.5">
                <Label>Org type</Label>
                <Select value={environment} onValueChange={setEnvironment}>
                  <SelectTrigger className="w-44">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="production">Production</SelectItem>
                    <SelectItem value="sandbox">Sandbox</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button onClick={connect} disabled={!data.available || !!busy}>
                {busy === "connect" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Connect Salesforce
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {conn && !conn.error && (
        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
            <div className="space-y-1.5">
              <CardTitle className="flex items-center gap-2">
                <ShieldCheck className="h-5 w-5" /> What we can read and write
              </CardTitle>
              <CardDescription>Straight from Salesforce, for the connected user.</CardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={() => checkAccess(data.settings.statusMap || {})} disabled={checking}>
              {checking ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
              Check again
            </Button>
          </CardHeader>
          <CardContent className="space-y-6">
            {!access ? (
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            ) : (
              <>
                {!access.ready && (
                  <p className="text-sm text-destructive">This user is missing rights the sync needs (marked below). Give them in Salesforce, then check again.</p>
                )}
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Object</TableHead>
                        <TableHead>Read</TableHead>
                        <TableHead>Create</TableHead>
                        <TableHead>Edit</TableHead>
                        <TableHead>Delete</TableHead>
                        <TableHead>Used by the sync</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {access.objects.map((o) => (
                        <TableRow key={o.name}>
                          <TableCell className="font-medium">{o.label}</TableCell>
                          <TableCell><Tick ok={o.read} /></TableCell>
                          <TableCell><Tick ok={o.create} /></TableCell>
                          <TableCell><Tick ok={o.edit} /></TableCell>
                          <TableCell><Tick ok={o.delete} /></TableCell>
                          <TableCell className="text-sm">
                            {!o.neededBySync ? (
                              <span className="text-muted-foreground">No</span>
                            ) : o.missing.length ? (
                              <span className="text-destructive">Needs {o.missing.join(", ")}</span>
                            ) : (
                              <span className="text-emerald-600 dark:text-emerald-400">Ready</span>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                {access.apiCalls && (
                  <p className="text-sm text-muted-foreground">
                    API calls left today: {access.apiCalls.remaining.toLocaleString()} of {access.apiCalls.max.toLocaleString()}
                  </p>
                )}

                <div className="space-y-2">
                  <h3 className="text-sm font-medium">Optional AI4Home fields on Lead</h3>
                  <p className="text-sm text-muted-foreground">
                    Add any of these in Salesforce Setup → Object Manager → Lead → Fields, with exactly this API name, and the sync fills them. Without them, the booking link and portal link still go on every meeting.
                  </p>
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>API name</TableHead>
                          <TableHead>Type</TableHead>
                          <TableHead>Holds</TableHead>
                          <TableHead>In your org</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {access.customFields.map((f) => (
                          <TableRow key={f.name}>
                            <TableCell className="font-mono text-xs">{f.name}</TableCell>
                            <TableCell className="text-sm">{f.type}</TableCell>
                            <TableCell className="text-sm text-muted-foreground">{f.note}</TableCell>
                            <TableCell>{f.present ? <Badge className={RUN_STYLE.SUCCESS}>Found</Badge> : <Badge variant="outline">Not added</Badge>}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {conn && !conn.error && access && (
        <Card>
          <CardHeader>
            <CardTitle>Lead status mapping</CardTitle>
            <CardDescription>
              Which Salesforce Lead Status each portal status becomes, and back. A status left on &quot;Don&apos;t sync&quot; never changes the other side.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              {B2B_LEAD_STATUSES.map((status) => (
                <div key={status} className="flex items-center justify-between gap-3">
                  <Label className="w-28">{titleCase(status)}</Label>
                  <Select value={statusMap[status] || NONE} onValueChange={(v) => setStatusMap((m) => ({ ...m, [status]: v === NONE ? null : v }))}>
                    <SelectTrigger className="flex-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>Don&apos;t sync</SelectItem>
                      {access.leadStatuses.map((s) => (
                        <SelectItem key={s.value} value={s.value}>
                          {s.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>
            <Button onClick={saveMapping} disabled={!!busy || mappingSaved}>
              {busy === "map" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {mappingSaved ? "Mapping saved" : "Save mapping"}
            </Button>
          </CardContent>
        </Card>
      )}

      {conn && (
        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
            <div className="space-y-1.5">
              <CardTitle className="flex items-center gap-2">
                Sync {enabled ? <Badge className={RUN_STYLE.SUCCESS}>On</Badge> : <Badge variant="outline">Off</Badge>}
              </CardTitle>
              <CardDescription>Runs every 5 minutes. Salesforce changes come in first, then portal changes go up.</CardDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              {enabled && (
                <>
                  <Button variant="outline" size="sm" onClick={() => act("sync", () => sendJson(`${API}/sync`, "POST"), "Sync started.")} disabled={!!busy}>
                    {busy === "sync" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                    Sync now
                  </Button>
                  <Button variant="outline" size="sm" onClick={resync} disabled={!!busy}>
                    Resync everything
                  </Button>
                </>
              )}
              <Button
                size="sm"
                variant={enabled ? "outline" : "default"}
                onClick={() => setEnabled(!enabled)}
                disabled={!!busy || (!enabled && (!access?.ready || !mappingSaved || !!conn.error))}
              >
                {busy === "enable" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {enabled ? "Pause sync" : "Start sync"}
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            {!enabled && (!access?.ready || !mappingSaved) && (
              <p className="text-muted-foreground">Check the access above and save the status mapping before starting.</p>
            )}
            <p>
              Waiting to go to Salesforce: {data.pending.leads} leads, {data.pending.meetings} meetings, {data.pending.messages} messages, {data.pending.deletions} deletes.
            </p>
            {data.lastRun && (
              <div className="space-y-2">
                <p>
                  Last run {when(data.lastRun.at)} <Badge className={RUN_STYLE[data.lastRun.status]}>{titleCase(data.lastRun.status)}</Badge>
                </p>
                <p className="text-muted-foreground">{data.lastRun.message}</p>
                {data.lastRun.errors.length > 0 && (
                  <ul className="list-disc space-y-1 pl-5 text-destructive">
                    {data.lastRun.errors.map((e, i) => (
                      <li key={i}>{e}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            {data.logs.length > 0 && (
              <div className="space-y-1">
                <h3 className="font-medium">History</h3>
                {data.logs.map((l) => (
                  <div key={l.id} className="flex flex-wrap items-center gap-2 text-muted-foreground">
                    <span className="w-40 shrink-0">{when(l.createdAt)}</span>
                    <Badge className={RUN_STYLE[l.status]}>{titleCase(l.status)}</Badge>
                    <span>{l.message}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
