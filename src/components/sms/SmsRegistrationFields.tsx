"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// SRS 8.1: what Telnyx needs to register a builder's brand and campaign.
// Filled in by the builder (Settings → Email & SMS) or by the Super Admin on its behalf.
export type SmsRegistration = {
  legalName: string;
  ein: string;
  entityType: "PRIVATE_PROFIT" | "PUBLIC_PROFIT" | "NON_PROFIT";
  street: string;
  city: string;
  state: string;
  postalCode: string;
  website: string;
  email: string;
  phone: string;
  contactFirstName: string;
  contactLastName: string;
  contactEmail: string;
  optInFlow: string;
  privacyPolicyUrl: string;
  areaCode: string;
};

export const emptySmsRegistration = (company: { name?: string | null; email?: string | null; phone?: string | null }): SmsRegistration => ({
  legalName: company.name || "",
  ein: "",
  entityType: "PRIVATE_PROFIT",
  street: "",
  city: "",
  state: "",
  postalCode: "",
  website: "",
  email: company.email || "",
  phone: company.phone || "",
  contactFirstName: "",
  contactLastName: "",
  contactEmail: "",
  optInFlow:
    "Homebuyers opt in by checking an unchecked box on our website contact form, or on a sign-in sheet at the model home, agreeing to receive texts about homes, appointments and warranty service. Message frequency varies; msg & data rates may apply; reply STOP to opt out.",
  privacyPolicyUrl: "",
  areaCode: "",
});

const FIELDS: { key: Exclude<keyof SmsRegistration, "entityType" | "optInFlow">; label: string; placeholder?: string; half?: boolean }[] = [
  { key: "legalName", label: "Legal business name (exactly as on IRS records)" },
  { key: "ein", label: "EIN (tax ID)", placeholder: "12-3456789", half: true },
  { key: "areaCode", label: "Preferred area code (optional)", placeholder: "512", half: true },
  { key: "street", label: "Street" },
  { key: "city", label: "City", half: true },
  { key: "state", label: "State", placeholder: "TX", half: true },
  { key: "postalCode", label: "ZIP code", half: true },
  { key: "website", label: "Website", placeholder: "https://", half: true },
  { key: "email", label: "Support email", half: true },
  { key: "phone", label: "Support phone", half: true },
  { key: "contactFirstName", label: "Compliance contact first name", half: true },
  { key: "contactLastName", label: "Compliance contact last name", half: true },
  { key: "contactEmail", label: "Compliance contact email" },
  { key: "privacyPolicyUrl", label: "Privacy policy URL (optional, helps approval)", placeholder: "https://" },
];

export function SmsRegistrationFields({ value, onChange }: { value: SmsRegistration; onChange: (next: SmsRegistration) => void }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="space-y-1.5 sm:col-span-2">
        <Label htmlFor="reg-entityType">Business type</Label>
        <select
          id="reg-entityType"
          className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
          value={value.entityType}
          onChange={(e) => onChange({ ...value, entityType: e.target.value as SmsRegistration["entityType"] })}
        >
          <option value="PRIVATE_PROFIT">Private company</option>
          <option value="PUBLIC_PROFIT">Publicly traded company</option>
          <option value="NON_PROFIT">Non-profit</option>
        </select>
      </div>
      {FIELDS.map((field) => (
        <div key={field.key} className={`space-y-1.5 ${field.half ? "" : "sm:col-span-2"}`}>
          <Label htmlFor={`reg-${field.key}`}>{field.label}</Label>
          <Input
            id={`reg-${field.key}`}
            placeholder={field.placeholder}
            value={value[field.key]}
            onChange={(e) => onChange({ ...value, [field.key]: e.target.value })}
          />
        </div>
      ))}
      <div className="space-y-1.5 sm:col-span-2">
        <Label htmlFor="reg-optInFlow">How buyers agree to receive texts</Label>
        <textarea
          id="reg-optInFlow"
          rows={4}
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
          value={value.optInFlow}
          onChange={(e) => onChange({ ...value, optInFlow: e.target.value })}
        />
        <p className="text-[11px] text-muted-foreground">
          Carriers reject vague answers. Say where the opt-in happens (web form, sign-in sheet) and that it&apos;s a separate, unchecked consent.
        </p>
      </div>
    </div>
  );
}
