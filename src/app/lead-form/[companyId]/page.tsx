"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { CheckCircle2, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";

type FormInfo = {
  companyName: string;
  logo: string | null;
  color: string;
  consent: { email: string; sms: string };
};

// Public, embeddable lead form. Builders drop it on their site in an iframe or
// share the link; each submission becomes a lead and fires the WEB_FORM trigger.
export default function LeadFormPage() {
  const params = useParams();
  const companyId = Array.isArray(params.companyId) ? params.companyId[0] : params.companyId;

  const [info, setInfo] = useState<FormInfo | null>(null);
  const [loadError, setLoadError] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);

  useEffect(() => {
    fetch(`/api/public/lead-form/${companyId}`)
      .then(async (r) => (r.ok ? setInfo(await r.json()) : setLoadError("This form is not available.")))
      .catch(() => setLoadError("This form could not be loaded."));
  }, [companyId]);

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    const data = Object.fromEntries(new FormData(e.currentTarget));
    try {
      const res = await fetch(`/api/public/lead-form/${companyId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // The page embedding the iframe, so staff can see which page converted.
        body: JSON.stringify({ ...data, page: document.referrer || window.location.href }),
      });
      if (res.ok) setSent(true);
      else setError((await res.json().catch(() => null))?.message || "Something went wrong. Please try again.");
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  if (loadError) return <p className="p-6 text-center text-sm text-muted-foreground">{loadError}</p>;
  if (!info) {
    return (
      <div className="flex justify-center p-10">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <main className="min-h-dvh bg-background p-4 sm:p-6">
      <div className="mx-auto max-w-lg rounded-2xl border bg-card p-5 sm:p-6 shadow-sm">
        <div className="mb-5 flex items-center gap-3">
          {info.logo && <img src={info.logo} alt="" className="h-10 w-10 rounded-full object-contain bg-white" />}
          <div>
            <h1 className="text-lg font-semibold">{info.companyName}</h1>
            <p className="text-sm text-muted-foreground">Tell us what you&apos;re looking for and we&apos;ll be in touch.</p>
          </div>
        </div>

        {sent ? (
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <CheckCircle2 className="h-10 w-10" style={{ color: info.color }} />
            <p className="font-medium">Thank you!</p>
            <p className="text-sm text-muted-foreground">We&apos;ve received your details and will be in touch shortly.</p>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="firstName">First name *</Label>
                <Input id="firstName" name="firstName" required autoComplete="given-name" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="lastName">Last name</Label>
                <Input id="lastName" name="lastName" autoComplete="family-name" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input id="email" name="email" type="email" autoComplete="email" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="phone">Phone</Label>
              <Input id="phone" name="phone" type="tel" autoComplete="tel" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="interest">Community or home you&apos;re interested in</Label>
              <Input id="interest" name="interest" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="message">Message</Label>
              <Textarea id="message" name="message" rows={3} />
            </div>

            {/* Honeypot: hidden from people, filled in by bots. */}
            <input type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" className="hidden" />

            <label className="flex items-start gap-2 text-xs text-muted-foreground">
              <input type="checkbox" name="emailOptIn" value="true" className="mt-0.5" />
              <span>{info.consent.email}</span>
            </label>
            <label className="flex items-start gap-2 text-xs text-muted-foreground">
              <input type="checkbox" name="smsOptIn" value="true" className="mt-0.5" />
              <span>{info.consent.sms}</span>
            </label>

            {error && <p className="text-sm text-destructive">{error}</p>}

            <Button type="submit" disabled={busy} className="w-full text-white" style={{ backgroundColor: info.color }}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Send"}
            </Button>
          </form>
        )}
      </div>
    </main>
  );
}
