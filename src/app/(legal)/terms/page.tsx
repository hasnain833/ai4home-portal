import type { Metadata } from "next";
import { AlertTriangle } from "lucide-react";
import { LegalSection, LegalList, Placeholder } from "@/components/legal/legal-ui";

export const metadata: Metadata = {
  title: "Terms of Service — Aiforhomebuilder",
  description: "The terms governing use of the Aiforhomebuilder platform.",
};

const LAST_UPDATED = "July 16, 2026";

export default function TermsPage() {
  return (
    <article>
      <h1 className="text-3xl font-bold tracking-tight">Terms of Service</h1>
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
        <LegalSection title="1. Acceptance of Terms">
          <p>
            These Terms of Service (&ldquo;Terms&rdquo;) govern your access to and use of the
            Aiforhomebuilder platform, websites, and related services (collectively, the
            &ldquo;Service&rdquo;) provided by{" "}
            <Placeholder>Aiforhomebuilder Technologies Inc.</Placeholder> (&ldquo;we&rdquo;,
            &ldquo;us&rdquo;, or &ldquo;Company&rdquo;). By creating an account, accessing, or using
            the Service, you agree to be bound by these Terms. If you are entering into these Terms on
            behalf of a company or other legal entity, you represent that you have the authority to
            bind that entity.
          </p>
        </LegalSection>

        <LegalSection title="2. Description of the Service">
          <p>
            The Service is a multi-tenant platform for homebuilders and their customers that provides
            warranty care management, customer support automation, sales and marketing workflows,
            content tools, and related integrations. Features available to you depend on your
            subscription and configuration.
          </p>
        </LegalSection>

        <LegalSection title="3. Accounts and Registration">
          <LegalList
            items={[
              "You must provide accurate, current, and complete information during registration and keep it up to date.",
              "You are responsible for safeguarding your account credentials and for all activity that occurs under your account.",
              "You must notify us promptly of any unauthorized use of your account or any other breach of security.",
              "Accounts may be subject to verification before full access is granted.",
            ]}
          />
        </LegalSection>

        <LegalSection title="4. Acceptable Use">
          <p>You agree not to, and not to permit any third party to:</p>
          <LegalList
            items={[
              "Use the Service in violation of any applicable law or regulation, including telemarketing, anti-spam (e.g., CAN-SPAM), and consumer-protection laws (e.g., TCPA);",
              "Send messages to recipients who have not provided the consent required by law, or after they have opted out;",
              "Upload or transmit malicious code, or attempt to gain unauthorized access to the Service or its related systems;",
              "Interfere with or disrupt the integrity or performance of the Service;",
              "Reverse engineer or attempt to extract the source code of the Service, except as permitted by law.",
            ]}
          />
        </LegalSection>

        <LegalSection title="5. Customer Data and Content">
          <p>
            You retain all rights to the data and content you or your customers submit to the Service
            (&ldquo;Customer Data&rdquo;). You grant us a limited license to host, process, and
            transmit Customer Data solely to provide and support the Service. You are responsible for
            the accuracy and legality of Customer Data and for obtaining all consents necessary for us
            to process it on your behalf. Our handling of personal data is described in our{" "}
            <a href="/privacy" className="font-medium text-primary hover:underline">
              Privacy Policy
            </a>
            .
          </p>
        </LegalSection>

        <LegalSection title="6. Third-Party Services and Integrations">
          <p>
            The Service integrates with third-party products (for example CRM/ERP systems, email and
            SMS providers, AI model providers, and chat/automation engines). Your use of those
            integrations may be subject to the third party&rsquo;s terms, and we are not responsible
            for third-party services. You are responsible for any credentials or API keys you connect
            to the Service and for the fees charged by those providers.
          </p>
        </LegalSection>

        <LegalSection title="7. AI-Generated Content">
          <p>
            The Service may generate drafts, summaries, and suggestions using artificial intelligence.
            AI output may be inaccurate or incomplete and is provided for your review. You are
            responsible for reviewing and approving any AI-assisted content before it is published or
            sent.
          </p>
        </LegalSection>

        <LegalSection title="8. Fees and Payment">
          <p>
            If your use of the Service is subject to fees, you agree to pay all fees described in your
            order or subscription. Except as required by law or expressly stated, fees are
            non-refundable. We may suspend the Service for non-payment. Specific pricing and billing
            terms are set out in your order at{" "}
            <Placeholder>[pricing / order reference]</Placeholder>.
          </p>
        </LegalSection>

        <LegalSection title="9. Disclaimers">
          <p>
            THE SERVICE IS PROVIDED &ldquo;AS IS&rdquo; AND &ldquo;AS AVAILABLE&rdquo; WITHOUT
            WARRANTIES OF ANY KIND, WHETHER EXPRESS, IMPLIED, OR STATUTORY, INCLUDING IMPLIED
            WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND NON-INFRINGEMENT. WE
            DO NOT WARRANT THAT THE SERVICE WILL BE UNINTERRUPTED, SECURE, OR ERROR-FREE.
          </p>
        </LegalSection>

        <LegalSection title="10. Limitation of Liability">
          <p>
            TO THE MAXIMUM EXTENT PERMITTED BY LAW, IN NO EVENT WILL THE COMPANY BE LIABLE FOR ANY
            INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, OR ANY LOSS OF PROFITS,
            REVENUE, OR DATA, ARISING OUT OF OR RELATED TO YOUR USE OF THE SERVICE. OUR TOTAL
            LIABILITY FOR ANY CLAIM WILL NOT EXCEED THE AMOUNTS YOU PAID FOR THE SERVICE IN THE{" "}
            <Placeholder>[twelve (12) months]</Placeholder> PRECEDING THE EVENT GIVING RISE TO THE
            CLAIM.
          </p>
        </LegalSection>

        <LegalSection title="11. Indemnification">
          <p>
            You agree to indemnify and hold harmless the Company from any claims, damages, and
            expenses (including reasonable legal fees) arising from your Customer Data, your use of the
            Service, or your violation of these Terms or applicable law.
          </p>
        </LegalSection>

        <LegalSection title="12. Term and Termination">
          <p>
            These Terms remain in effect while you use the Service. You may stop using the Service at
            any time. We may suspend or terminate your access if you materially breach these Terms or
            use the Service in a way that creates legal or security risk. Upon termination, your right
            to use the Service ceases, and we will handle Customer Data as described in the Privacy
            Policy and any applicable data-processing terms.
          </p>
        </LegalSection>

        <LegalSection title="13. Changes to the Service or Terms">
          <p>
            We may modify the Service or these Terms from time to time. If we make material changes, we
            will update the &ldquo;Last updated&rdquo; date above and, where appropriate, provide
            additional notice. Your continued use of the Service after changes take effect constitutes
            acceptance of the revised Terms.
          </p>
        </LegalSection>

        <LegalSection title="14. Governing Law">
          <p>
            These Terms are governed by the laws of{" "}
            <Placeholder>[jurisdiction]</Placeholder>, without regard to its conflict-of-laws rules.
            The parties submit to the exclusive jurisdiction of the courts located in{" "}
            <Placeholder>[venue]</Placeholder>.
          </p>
        </LegalSection>

        <LegalSection title="15. Contact Us">
          <p>
            Questions about these Terms can be sent to{" "}
            <Placeholder>[legal@yourcompany.com]</Placeholder> or by mail to{" "}
            <Placeholder>[Company legal address]</Placeholder>.
          </p>
        </LegalSection>
      </div>
    </article>
  );
}
