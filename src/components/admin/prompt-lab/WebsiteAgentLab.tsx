"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { useUnsavedChanges } from "@/lib/use-unsaved-changes";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FlaskConical, History, Loader2, RotateCcw } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";

type Inquiry = { id: string; type: string; payload: { email?: string; name?: string }; adminSentAt: string | null; visitorSentAt: string | null; adminSmsSentAt: string | null; visitorSmsSentAt: string | null; attempts: number; nextAttemptAt: string; lastError: string | null };
type Conversation = { id: string; page: string; messages: { role: string; content: string }[]; draft: Record<string, string>; submittedAt: string | null; lastError: string | null; updatedAt: string };
type Activity = { prompt: string; defaultPrompt: string; productGuide: string; configuration: Record<string, boolean>; conversations: Conversation[]; inquiries: Inquiry[]; events: { action: string; targetId: string | null; metadata: unknown; createdAt: string }[] };
const endpoint = "/api/admin/prompt-lab/website-agent";
const json = (body: object, method = "PUT") => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

export default function WebsiteAgentLab() {
  const [data, setData] = useState<Activity | null>(null);
  const [prompt, setPrompt] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(async (includePrompt = false) => {
    try { const result = await apiFetch<Activity>(endpoint); setData(result); if (includePrompt) setPrompt(result.prompt); setError(""); }
    catch (e) { setError(e instanceof Error ? e.message : "Unable to load activity."); }
  }, []);
  useEffect(() => {
    let active = true;
    apiFetch<Activity>(endpoint).then((result) => {
      if (active) { setData(result); setPrompt(result.prompt); setError(""); }
    }).catch((e) => { if (active) setError(e instanceof Error ? e.message : "Unable to load activity."); });
    return () => { active = false; };
  }, []);
  const save = async () => {
    setBusy(true); setNotice("");
    try { await apiFetch(endpoint, json({ prompt })); setNotice("Prompt saved. New replies use these instructions."); await load(true); return true; }
    catch (e) { setError(e instanceof Error ? e.message : "Save failed."); return false; }
    finally { setBusy(false); }
  };
  const { dialog: unsavedDialog } = useUnsavedChanges({
    dirty: !!data && prompt !== data.prompt,
    itemName: "the Website agent prompt",
    onSave: save,
  });
  const retry = async (id: string) => {
    setBusy(true); setNotice("");
    try { const result = await apiFetch<{ failed?: boolean; skipped?: boolean }>(`${endpoint}/inquiries/${id}/retry`, json({}, "POST")); setNotice(result.skipped ? "Another attempt is running; refresh shortly." : result.failed ? "Attempt completed with errors. See the error below." : "Attempt completed. Provider acceptance statuses are shown below."); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : "Retry failed."); }
    finally { setBusy(false); }
  };
  return (
    <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-2 xl:grid-rows-[minmax(0,1fr)]">
      {unsavedDialog}
      {error && <p role="alert" className="text-sm text-red-600 xl:col-span-2">{error}</p>}
      {notice && <p role="status" className="text-sm xl:col-span-2">{notice}</p>}
      <Card className="flex min-h-0 min-w-0 flex-col overflow-hidden">
        <CardHeader className="shrink-0 flex-row items-center justify-between space-y-0 py-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            <FlaskConical className="h-3.5 w-3.5" /> Prompt
          </CardTitle>
          <Button variant="ghost" size="sm" className="gap-1.5" disabled={busy || !data} onClick={() => { if (data) setPrompt(data.defaultPrompt); }}>
            <RotateCcw className="h-3.5 w-3.5" /> Load default
          </Button>
        </CardHeader>
        <CardContent className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pb-3">
          {!data ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              {!error && <Loader2 className="h-4 w-4 animate-spin" />}
              {error ? "Prompt unavailable." : "Loading Website Agent..."}
            </p>
          ) : (
            <>
              <label htmlFor="website-prompt" className="text-[11px] text-muted-foreground">Conversation style and public product guidance</label>
              <Textarea id="website-prompt" value={prompt} onChange={(event) => setPrompt(event.target.value)} maxLength={20000} rows={18} className="min-h-64 flex-1 resize-none field-sizing-fixed font-mono text-[11px] leading-relaxed" />
              <p className="text-[11px] text-muted-foreground">Consultation requests require visitor approval. Preferred meeting times remain subject to team confirmation.</p>
              <p className="text-[11px] text-muted-foreground">The built-in product guide and privacy rules are added to every reply automatically. Keep customer details and credentials out of this public-facing prompt.</p>
              <details className="text-[11px] text-muted-foreground">
                <summary className="cursor-pointer">Built-in platform knowledge</summary>
                <pre className="mt-2 max-h-64 overflow-y-auto whitespace-pre-wrap rounded border p-3 font-sans leading-relaxed">{data.productGuide}</pre>
              </details>
              <div className="flex justify-end">
                <Button size="sm" disabled={busy || prompt.trim() === data.prompt} onClick={() => void save()}>Save &amp; go live</Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
      <Card className="flex min-h-0 min-w-0 flex-col overflow-hidden">
        <CardHeader className="shrink-0 flex-row items-center justify-between space-y-0 py-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            <History className="h-4 w-4 text-[#b48c3c]" /> Website activity
          </CardTitle>
          <Button variant="outline" size="sm" disabled={busy} onClick={() => void load()}>Refresh activity</Button>
        </CardHeader>
        <CardContent className="min-h-80 min-w-0 flex-1 space-y-5 overflow-y-auto pb-3">
          {data ? <>
        <p className="text-sm text-muted-foreground">Review website conversations and consultation notifications. Requests remain pending until the team confirms a meeting time.</p>
        <div className="flex flex-wrap gap-2">{Object.entries(data.configuration).map(([key, configured]) => <span key={key} className={`rounded border px-2 py-1 text-xs ${configured ? "text-green-700" : "text-red-600"}`}>{key}: {configured ? "configured" : "missing"}</span>)}</div>
        <p className="text-xs text-muted-foreground">Configuration checks confirm presence only. They do not prove provider access, worker synchronization, or delivery.</p>
        <details open><summary className="cursor-pointer font-medium">Notification attempts ({data.inquiries.length} recent inquiries)</summary>
          <p className="my-2 text-xs text-muted-foreground">Accepted means the sending provider accepted the message; inbox receipt and handset delivery are not verified. SMS is attempted once; further SMS attempts require the retry button. Pending emails retry automatically.</p>
          <div className="max-h-96 space-y-3 overflow-auto">{data.inquiries.map((item) => <div key={item.id} className="rounded border p-3 text-sm">
            <p className="font-medium">{item.payload.name || item.payload.email} · {item.type === "CONSULTATION" ? "Product Consultation" : item.type}</p><p className="break-all text-xs text-muted-foreground">{item.id}</p>
            <p>Team email: {item.adminSentAt ? "accepted" : "pending"} · Visitor email: {item.visitorSentAt ? "accepted" : "pending"}</p>
            {["CONSULTATION", "BOOKING"].includes(item.type) && <p>Team SMS: {item.adminSmsSentAt ? "accepted" : "not sent"} · Visitor SMS: {item.visitorSmsSentAt ? "accepted" : "not sent"} · Automatic SMS retries off</p>}
            <p>Attempts: {item.attempts}{(!item.adminSentAt || !item.visitorSentAt) ? ` · Next email retry eligible: ${new Date(item.nextAttemptAt).toLocaleString()}` : ""}</p>
            {item.lastError && <p className="whitespace-pre-wrap text-red-600">{item.lastError}</p>}
            <Button size="sm" variant="outline" disabled={busy} onClick={() => void retry(item.id)}>Retry pending notifications</Button>
          </div>)}{!data.inquiries.length && <p className="py-2 text-sm">No inquiries recorded.</p>}</div>
        </details>
        <details><summary className="cursor-pointer font-medium">Website conversations ({data.conversations.length} recent)</summary>
          <div className="max-h-[36rem] space-y-3 overflow-auto">{data.conversations.map((chat) => <details key={chat.id} className="rounded border p-3 text-sm"><summary className="cursor-pointer break-all">{chat.draft.name || "Visitor"} · {chat.submittedAt ? "Request submitted" : "Conversation"} · {new Date(chat.updatedAt).toLocaleString()}</summary>
            <p className="my-2 break-all text-xs">Conversation: {chat.id} · Page: {chat.page}</p>{chat.lastError && <p className="text-red-600">{chat.lastError}</p>}
            {chat.messages.map((message, index) => <p key={index} className="my-2 whitespace-pre-wrap"><strong>{message.role === "user" ? "Visitor" : "Assistant"}:</strong> {message.content}</p>)}
          </details>)}</div>
        </details>
        <details><summary className="cursor-pointer font-medium">API activity ({data.events.length} recent events)</summary><div className="max-h-80 space-y-2 overflow-auto">{data.events.map((event, index) => <div key={index} className="break-all rounded border p-2 text-xs"><p>{new Date(event.createdAt).toLocaleString()} · {event.action}</p><p>Conversation: {event.targetId || "none"}</p><pre className="whitespace-pre-wrap">{JSON.stringify(event.metadata, null, 2)}</pre></div>)}</div></details>

          </> : <p className="text-sm text-muted-foreground">{error ? "Activity unavailable." : "Loading activity?"}</p>}
        </CardContent>
      </Card>
    </div>
  );
}
