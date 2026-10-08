"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CalendarCheck, Camera, CheckCircle2, Loader2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SignInEmailField } from "@/components/auth/SignInEmailField";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface CalendlyStatus {
  available: boolean;
  connected: boolean;
  email: string | null;
  connectedAt: string | null;
  eventType: { uri: string; name: string; duration: number } | null;
}

interface CalendlyEventType {
  uri: string;
  name: string;
  duration: number;
}

const NONE = "none";

/** Which Calendly event type homeowners book. Loaded once Calendly is connected. */
function EventTypePicker({ current, onSaved }: { current: CalendlyStatus["eventType"]; onSaved: () => void }) {
  const [types, setTypes] = useState<CalendlyEventType[] | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/trade/calendly/event-types")
      .then(async (r) => {
        const data = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(data.message || "Could not load your event types.");
        setTypes(data);
      })
      .catch((err) => setError(err.message));
  }, []);

  const choose = async (uri: string) => {
    setSaving(true);
    setError("");
    const r = await fetch("/api/trade/calendly/event-type", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uri: uri === NONE ? null : uri }),
    });
    const data = await r.json().catch(() => ({}));
    setSaving(false);
    if (!r.ok) return setError(data.message || "Could not save.");
    onSaved();
  };

  return (
    <div className="space-y-2 border-t pt-4">
      <Label>Event type homeowners book</Label>
      {!types && !error && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
      {types && (
        <Select value={current?.uri || NONE} onValueChange={choose} disabled={saving}>
          <SelectTrigger className="max-w-md">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>None (only hide my busy times)</SelectItem>
            {types.map((t) => (
              <SelectItem key={t.uri} value={t.uri}>
                {t.name} · {t.duration} min
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      <p className="text-xs text-muted-foreground">
        {current
          ? `Homeowners pick from the open times of "${current.name}" and the visit is booked straight into your Calendly. Online booking needs a paid Calendly plan (Standard or above).`
          : "Pick one so homeowners book from your Calendly openings. With none, they book from the builder's hours and your Calendly busy times are hidden."}
      </p>
      {types && types.length === 0 && (
        <p className="text-xs text-muted-foreground">No active event types on your Calendly. Create one in Calendly first.</p>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}

const RESULT_MESSAGES: Record<string, string> = {
  connected: "Calendly connected.",
  cancelled: "Calendly connection was cancelled.",
  failed: "Could not connect Calendly. Please try again.",
};

/** Name, photo, phone and sign-in email. The email change is confirmed from the new address. */
function ProfileCard() {
  const { user, updateProfile, updateAvatar } = useAuth();
  const [name, setName] = useState(user?.name || "");
  const [phone, setPhone] = useState(user?.phone || "");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const dirty = name.trim() !== (user?.name || "") || phone.trim() !== (user?.phone || "");

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return setMessage({ type: "error", text: "Name is required." });
    setSaving(true);
    setMessage(null);
    try {
      await updateProfile({ name: name.trim(), phone: phone.trim() || null });
      setMessage({ type: "success", text: "Profile saved." });
    } catch (err) {
      setMessage({ type: "error", text: err instanceof Error ? err.message : "Could not save your profile." });
    } finally {
      setSaving(false);
    }
  };

  const uploadAvatar = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = () => updateAvatar(reader.result as string);
    reader.readAsDataURL(file);
  };

  const initials = (user?.name || "T").split(" ").map((n) => n[0]).join("").toUpperCase();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Profile</CardTitle>
        <CardDescription>Builders and homeowners see your name and phone on jobs.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={save} className="space-y-5">
          <div className="flex items-center gap-4">
            <div className="relative">
              <Avatar className="h-20 w-20 border">
                <AvatarImage src={user?.avatar} />
                <AvatarFallback className="text-2xl bg-secondary text-primary">{initials}</AvatarFallback>
              </Avatar>
              <label
                htmlFor="trade-avatar"
                className="absolute bottom-0 right-0 cursor-pointer rounded-full bg-primary p-1.5 text-white shadow-md hover:bg-primary/90"
                title="Change photo"
              >
                <Camera className="h-4 w-4" />
                <input id="trade-avatar" type="file" accept="image/*" className="hidden" onChange={uploadAvatar} />
              </label>
            </div>
            <div className="min-w-0">
              <p className="font-semibold truncate">{user?.name}</p>
              <p className="text-sm text-muted-foreground truncate">{user?.email}</p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div className="space-y-2">
              <Label htmlFor="trade-name">Full name</Label>
              <Input id="trade-name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="trade-phone">Mobile phone</Label>
              <Input id="trade-phone" type="tel" placeholder="(555) 123-4567" value={phone} onChange={(e) => setPhone(e.target.value)} />
              <p className="text-xs text-muted-foreground">New jobs are also sent to you by SMS.</p>
            </div>
            <div className="space-y-2 md:col-span-2">
              <SignInEmailField onNotify={(type, text) => setMessage({ type, text })} />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" disabled={saving || !dirty} className="bg-[#0F3B3D] hover:bg-[#0F3B3D]/90 gap-2">
              {saving && <Loader2 className="h-4 w-4 animate-spin" />} Save changes
            </Button>
            {message && (
              <p className={`text-sm ${message.type === "success" ? "text-emerald-700 dark:text-emerald-300" : "text-red-600"}`}>
                {message.text}
              </p>
            )}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function TradeSettings() {
  const result = useSearchParams().get("calendly");
  const [status, setStatus] = useState<CalendlyStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // Bumped after disconnecting to refetch.
  const [version, setVersion] = useState(0);

  useEffect(() => {
    fetch("/api/trade/calendly")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setStatus)
      .catch(() => setError("Could not load your Calendly status."));
  }, [version]);

  const connect = async () => {
    setBusy(true);
    setError("");
    const r = await fetch("/api/trade/calendly/connect", { method: "POST" });
    const data = await r.json().catch(() => ({}));
    if (!r.ok || !data.url) {
      setBusy(false);
      return setError(data.message || "Could not start the Calendly connection.");
    }
    window.location.href = data.url;
  };

  const disconnect = async () => {
    setBusy(true);
    setError("");
    const r = await fetch("/api/trade/calendly", { method: "DELETE" });
    setBusy(false);
    if (!r.ok) return setError("Could not disconnect Calendly.");
    setVersion((v) => v + 1);
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground mt-1">Your profile and calendar.</p>
      </div>

      <ProfileCard />

      {result && RESULT_MESSAGES[result] && (
        <p className={`text-sm ${result === "connected" ? "text-emerald-700 dark:text-emerald-300" : "text-red-600"}`}>
          {RESULT_MESSAGES[result]}
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <CalendarCheck className="h-5 w-5 text-[#0F3B3D] dark:text-[#E8B86B]" /> Calendly
          </CardTitle>
          <CardDescription>
            Connect your Calendly so homeowners book your visits from your real openings. Visits they book,
            move or cancel are kept in step with your Calendly.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {!status && !error && <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />}
          {status && !status.available && (
            <p className="text-muted-foreground">Calendly isn&apos;t available on this portal yet.</p>
          )}
          {status?.available && status.connected && (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="flex items-center gap-2 text-emerald-700 dark:text-emerald-300">
                  <CheckCircle2 className="h-4 w-4" />
                  Connected{status.email ? ` as ${status.email}` : ""}
                </p>
                <Button variant="outline" size="sm" onClick={disconnect} disabled={busy}>
                  Disconnect
                </Button>
              </div>
              <EventTypePicker current={status.eventType} onSaved={() => setVersion((v) => v + 1)} />
            </>
          )}
          {status?.available && !status.connected && (
            <Button onClick={connect} disabled={busy} className="bg-[#0F3B3D] hover:bg-[#0F3B3D]/90 gap-2">
              {busy && <Loader2 className="h-4 w-4 animate-spin" />} Connect Calendly
            </Button>
          )}
          {error && <p className="text-red-600">{error}</p>}
        </CardContent>
      </Card>
    </div>
  );
}

// useSearchParams needs a Suspense boundary above it for the page to build.
export default function TradeSettingsPage() {
  return (
    <Suspense>
      <TradeSettings />
    </Suspense>
  );
}
