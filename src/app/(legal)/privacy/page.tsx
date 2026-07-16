import type { Metadata } from "next";
import { AlertTriangle } from "lucide-react";
import { LegalSection, LegalList, Placeholder } from "@/components/legal/legal-ui";

export const metadata: Metadata = {
  title: "Privacy Policy — Aiforhomebuilder",
  description: "How the Aiforhomebuilder platform collects, uses, and protects personal data.",
};

const LAST_UPDATED = "July 16, 2026";

export default function PrivacyPage() {
  return (
    <article>
      <h1 className="text-3xl font-bold tracking-tight">Privacy Policy</h1>
      <p className="mt-2 text-sm text-muted-foreground">Last updated: {LAST_UPDATED}</p>

      {/* Template notice — keep visible until reviewed by counsel. */}
      <div className="mt-6 flex gap-3 rounded-lg border border-amber-300/60 bg-amber-50 px-4 py-3 text-xs leading-relaxed text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-200">
        <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
        <span>
          This is a template. Highlighted{" "}
          <Placeholder>placeholders</Placeholder> must be completed and the full text reviewed by
          qualified legal counsel before it is relied upon.
        </span>
      </div>

      <div className="mt-8">
        <LegalSection title="1. Introduction">
          <p>
            This Privacy Policy explains how{" "}
            <Placeholder>Aiforhomebuilder Technologies Inc.</Placeholder> (&ldquo;we&rdquo;,
            &ldquo;us&rdquo;, or &ldquo;Company&rdquo;) collects, uses, discloses, and protects
            personal data in connection with the Aiforhomebuilder platform (the &ldquo;Service&rdquo;).
            It applies to the personal data we process as a controller. Where we process personal data
            on behalf of a customer (a homebuilder using the Service), that customer is the controller
            and we act as a processor under their instructions and any applicable data-processing
            agreement.
          </p>
        </LegalSection>

        <LegalSection title="2. Information We Collect">
          <LegalList
            items={[
              "Account and contact information — such as name, business email, phone number, and company details provided at registration.",
              "Customer and lead data — information that customers upload or that is synced from connected systems (for example CRM/ERP records, homeowner and property details, warranty tickets).",
              "Communications — messages, support requests, and content you create or send through the Service.",
              "Usage and device data — log data, IP address, browser type, and interactions with the Service, collected to operate and secure it.",
              "Cookies and similar technologies — used for authentication and to remember preferences (see the Cookies section).",
            ]}
          />
        </LegalSection>

        <LegalSection title="3. How We Use Information">
          <LegalList
            items={[
              "To provide, maintain, and improve the Service;",
              "To authenticate users and secure accounts;",
              "To generate AI-assisted drafts and summaries at your direction, using only the data necessary for the task;",
              "To send transactional and service-related communications;",
              "To provide customer support and respond to requests;",
              "To comply with legal obligations and enforce our terms.",
            ]}
          />
          <p>
            We do not use your inputs or outputs to train external AI models, and we minimize personal
            data included in AI prompts to what is necessary for the requested task.
          </p>
        </LegalSection>

        <LegalSection title="4. Legal Bases for Processing (EEA/UK)">
          <p>
            Where the GDPR or UK GDPR applies, we process personal data on the basis of: performance
            of a contract; our legitimate interests in operating and securing the Service; your
            consent (where required, for example certain communications); and compliance with legal
            obligations.
          </p>
        </LegalSection>

        <LegalSection title="5. How We Share Information">
          <p>We share personal data only as needed to run the Service:</p>
          <LegalList
            items={[
              "Service providers / subprocessors — such as cloud hosting, database, email and SMS providers, AI model providers, and chat/automation engines, who process data on our behalf under contract;",
              "Connected integrations you enable — for example CRM/ERP platforms, to which data is sent at your direction;",
              "Legal and safety — where required by law, regulation, or valid legal process, or to protect rights and safety;",
              "Business transfers — in connection with a merger, acquisition, or sale of assets, subject to this Policy.",
            ]}
          />
          <p>
            A current list of subprocessors is available at{" "}
            <Placeholder>[subprocessors list URL]</Placeholder>. We do not sell personal information.
          </p>
        </LegalSection>

        <LegalSection title="6. Data Retention">
          <p>
            We retain personal data for as long as needed to provide the Service and for legitimate
            business or legal purposes. Customer Data is retained according to the customer&rsquo;s
            configuration and instructions; uploaded import files are retained for a limited period
            (by default{" "}
            <Placeholder>[30 days]</Placeholder>) after processing. When data is deleted, we remove or
            de-identify it, including propagating deletions to derived stores where applicable.
          </p>
        </LegalSection>

        <LegalSection title="7. Security">
          <p>
            We use technical and organizational measures designed to protect personal data, including
            encryption in transit (TLS) and at rest for sensitive fields, tenant isolation,
            access controls, and audit logging. No method of transmission or storage is completely
            secure, and we cannot guarantee absolute security.
          </p>
        </LegalSection>

        <LegalSection title="8. Your Rights">
          <p>
            Depending on your location, you may have rights to access, correct, delete, or export your
            personal data, to object to or restrict certain processing, and to withdraw consent. Under
            the GDPR/UK GDPR and the CCPA/CPRA, this includes the right to request access to and
            deletion of your personal data, and the right not to be discriminated against for
            exercising these rights.
          </p>
          <p>
            Because we often act as a processor, requests relating to Customer Data should be directed
            to the relevant customer (controller); we will assist them in responding. To exercise
            rights regarding data we control, contact us at{" "}
            <Placeholder>[privacy@yourcompany.com]</Placeholder>. You may also have the right to lodge
            a complaint with a supervisory authority.
          </p>
        </LegalSection>

        <LegalSection title="9. Cookies">
          <p>
            We use strictly necessary cookies for authentication and session management, and may use
            cookies to remember preferences. You can control cookies through your browser settings;
            disabling necessary cookies may affect functionality.
          </p>
        </LegalSection>

        <LegalSection title="10. International Data Transfers">
          <p>
            We may process and store personal data in countries other than your own. Where required,
            we use appropriate safeguards (such as Standard Contractual Clauses) for international
            transfers of personal data.
          </p>
        </LegalSection>

        <LegalSection title="11. Children's Privacy">
          <p>
            The Service is intended for business users and is not directed to children. We do not
            knowingly collect personal data from children under{" "}
            <Placeholder>[16]</Placeholder>.
          </p>
        </LegalSection>

        <LegalSection title="12. Changes to This Policy">
          <p>
            We may update this Privacy Policy from time to time. Material changes will be reflected by
            updating the &ldquo;Last updated&rdquo; date above and, where appropriate, by additional
            notice.
          </p>
        </LegalSection>

        <LegalSection title="13. Contact Us">
          <p>
            For privacy questions or to exercise your rights, contact us at{" "}
            <Placeholder>[privacy@yourcompany.com]</Placeholder> or by mail at{" "}
            <Placeholder>[Company privacy address]</Placeholder>. Our data protection contact is{" "}
            <Placeholder>[DPO / privacy contact]</Placeholder>.
          </p>
        </LegalSection>
      </div>
    </article>
  );
}
