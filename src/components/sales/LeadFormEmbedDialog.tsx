"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Copy, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

function Snippet({ label, hint, code }: { label: string; hint: string; code: string }) {
  const copy = () =>
    navigator.clipboard.writeText(code).then(
      () => toast.success(`${label} copied`),
      () => toast.error("Could not copy — select the text and copy it manually."),
    );
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-sm font-medium">{label}</p>
          <p className="text-xs text-muted-foreground">{hint}</p>
        </div>
        <Button variant="outline" size="sm" onClick={copy} className="h-8 gap-1.5 shrink-0">
          <Copy className="h-3.5 w-3.5" /> Copy
        </Button>
      </div>
      <pre className="max-h-40 overflow-auto rounded-lg bg-muted p-3 text-xs whitespace-pre-wrap break-all">{code}</pre>
    </div>
  );
}

export default function LeadFormEmbedDialog({
  open,
  onOpenChange,
  companyId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId: string;
}) {
  // Read on the client: the snippets must carry this deployment's own address.
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);

  const formUrl = `${origin}/lead-form/${companyId}`;
  const postUrl = `${origin}/api/public/lead-form/${companyId}`;
  const iframe = `<iframe src="${formUrl}" style="width:100%;max-width:560px;height:760px;border:0;" title="Contact us"></iframe>`;
  const htmlForm = `<form action="${postUrl}" method="POST">
  <input name="firstName" placeholder="First name" required>
  <input name="lastName" placeholder="Last name">
  <input name="email" type="email" placeholder="Email">
  <input name="phone" type="tel" placeholder="Phone">
  <input name="interest" placeholder="Community or home">
  <textarea name="message" placeholder="Message"></textarea>
  <label><input type="checkbox" name="emailOptIn" value="true"> Email me about homes and offers</label>
  <label><input type="checkbox" name="smsOptIn" value="true"> Text me (Msg & data rates may apply, reply STOP to opt out)</label>
  <input type="hidden" name="redirect" value="https://your-website.com/thank-you">
  <button type="submit">Send</button>
</form>`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Capture leads from your website</DialogTitle>
          <DialogDescription>
            Every submission becomes a lead here, tagged <span className="font-medium">web-form</span>, with the consent they gave.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <Snippet
            label="1. Embed the form"
            hint="Paste this into any page of your website."
            code={iframe}
          />
          <div className="space-y-1.5">
            <Snippet label="2. Or share a link" hint="For ads, social posts or email signatures." code={formUrl} />
            <a href={formUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
              Preview the form <ExternalLink className="h-3 w-3" />
            </a>
          </div>
          <Snippet
            label="3. Or connect your existing form"
            hint="Point your form at this address using these field names. Only firstName and an email or phone are required."
            code={htmlForm}
          />

          <div className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
            To contact new leads instantly, create an automation with the trigger{" "}
            <span className="font-medium text-foreground">&quot;A lead fills in your website form&quot;</span> and the action{" "}
            <span className="font-medium text-foreground">Enroll in campaign</span>.{" "}
            <Link href="/sales/automations" className="text-primary hover:underline">
              Open Automations
            </Link>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
