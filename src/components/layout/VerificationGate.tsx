"use client";

import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import {
  ShieldCheck,
  UploadCloud,
  Clock,
  Loader2,
  CheckCircle2,
  FileText,
  Download,
  AlertCircle,
} from "lucide-react";


type DocKind = "agreement" | "verification";

const ENDPOINT: Record<DocKind, string> = {
  agreement: "/api/company/agreement",
  verification: "/api/company/verification",
};

// Bump together with the PDF in public/legal/ and AGREEMENT_VERSION in
// company.controller.js, which stamps the version onto the company.
const AGREEMENT_VERSION = "1.0";
const AGREEMENT_PATH = "/legal/platform-services-agreement-v1.pdf";

const MAX_BYTES = 10 * 1024 * 1024;
const ACCEPT = "application/pdf,image/png,image/jpeg,image/webp";

function DocumentSlot({
  kind,
  title,
  description,
  uploadedUrl,
  onUploaded,
  disabled,
}: {
  kind: DocKind;
  title: string;
  description: string;
  uploadedUrl: string | null;
  /** Resolves once the refreshed session is in context, so the slot can hold
   *  its spinner until the new state is actually visible. */
  onUploaded: () => Promise<unknown>;
  disabled: boolean;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    setError(null);
    const selected = e.target.files?.[0];
    if (!selected) return;
    if (selected.size > MAX_BYTES) {
      setError("That file is over 10 MB. Please upload a smaller scan.");
      return;
    }
    setFile(selected);
  };

  const handleUpload = async () => {
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const response = await fetch(ENDPOINT[kind], { method: "POST", body: formData });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.message || "Upload failed. Please try again.");
      }
      setFile(null);
      if (inputRef.current) inputRef.current.value = "";
      await onUploaded();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setUploading(false);
    }
  };

  const done = !!uploadedUrl && !file;

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 text-left dark:border-slate-700 dark:bg-slate-900/60">
      <div className="flex items-start gap-3">
        <div
          className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
            done
              ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
              : "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400"
          }`}
        >
          {done ? <CheckCircle2 className="h-4 w-4" /> : kind === "agreement" ? "1" : "2"}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-slate-900 dark:text-white">{title}</p>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{description}</p>

          {done ? (
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <a
                href={uploadedUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-xs font-medium text-[#b48c3c] hover:underline"
              >
                <FileText className="h-3.5 w-3.5" />
                View uploaded file
              </a>
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                disabled={disabled}
                className="text-xs text-slate-500 hover:text-slate-700 disabled:opacity-50 dark:text-slate-400 dark:hover:text-slate-200"
              >
                Replace
              </button>
            </div>
          ) : (
            <div className="mt-3 space-y-2">
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                disabled={disabled}
                className="flex w-full items-center justify-center gap-2 rounded-lg border-2 border-dashed border-slate-300 bg-slate-50 px-3 py-4 text-xs text-slate-500 transition hover:border-[#b48c3c] hover:bg-[#b48c3c]/5 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800/40 dark:text-slate-400"
              >
                {file ? (
                  <>
                    <FileText className="h-4 w-4 text-[#b48c3c]" />
                    <span className="truncate font-medium text-[#b48c3c]">{file.name}</span>
                  </>
                ) : (
                  <>
                    <UploadCloud className="h-4 w-4" />
                    <span className="font-medium">Choose file — PDF or image, up to 10 MB</span>
                  </>
                )}
              </button>

              {file && (
                <Button
                  onClick={handleUpload}
                  disabled={uploading || disabled}
                  size="sm"
                  className="w-full bg-[#0F3B3D] text-white hover:bg-[#0F3B3D]/90"
                >
                  {uploading ? (
                    <>
                      <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                      Uploading…
                    </>
                  ) : (
                    "Upload"
                  )}
                </Button>
              )}
            </div>
          )}

          {error && (
            <p className="mt-2 flex items-start gap-1.5 text-xs text-red-600 dark:text-red-400">
              <AlertCircle className="mt-px h-3.5 w-3.5 shrink-0" />
              {error}
            </p>
          )}
        </div>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        className="hidden"
        onChange={handleSelect}
      />
    </div>
  );
}

export default function VerificationGate() {
  const { user, refreshUser } = useAuth();

  // The session is the single source of truth: each upload refreshes it, so
  // there is nothing to mirror into local state and nothing to resynchronise.
  const status = user?.verificationStatus || "PENDING";
  const agreementUrl = user?.agreementDocUrl || null;
  const verificationUrl = user?.verificationDocUrl || null;

  const isAdmin = user?.role === "admin";

  useEffect(() => {
    if (status !== "SUBMITTED") return;
    const interval = setInterval(async () => {
      const updated = await refreshUser();
      if (updated?.verificationStatus === "VERIFIED") clearInterval(interval);
    }, 20000);
    return () => clearInterval(interval);
  }, [status, refreshUser]);

  if (status === "VERIFIED") return null;

  const bothUploaded = !!agreementUrl && !!verificationUrl;

  // Each upload refreshes the session; the gate re-renders from it.
  const handleUploaded = () => refreshUser();

  return (
    <div className="absolute inset-0 z-30 flex items-start justify-center overflow-auto p-4 sm:items-center">
      <div className="my-auto w-full max-w-xl rounded-2xl border border-slate-200 bg-white/95 p-6 shadow-2xl backdrop-blur-xl dark:border-slate-700 dark:bg-slate-900/95 sm:p-8">
        <div className="text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-[#0F3B3D]/10 text-[#0F3B3D] dark:bg-[#0F3B3D]/30 dark:text-[#a0c5c7]">
            {status === "SUBMITTED" ? <Clock className="h-7 w-7" /> : <ShieldCheck className="h-7 w-7" />}
          </div>

          {status === "SUBMITTED" ? (
            <>
              <h2 className="text-xl font-bold text-slate-900 dark:text-white">
                Verification in review
              </h2>
              <p className="mx-auto mt-2 max-w-md text-sm text-slate-500 dark:text-slate-400">
                Thanks — both documents have been submitted. Our team is reviewing them, and your
                Warranty Care workspace will unlock automatically once they&apos;re approved.
              </p>
            </>
          ) : isAdmin ? (
            <>
              <h2 className="text-xl font-bold text-slate-900 dark:text-white">
                Verify your account to continue
              </h2>
              <p className="mx-auto mt-2 max-w-md text-sm text-slate-500 dark:text-slate-400">
                Your workspace is locked until we verify your business. Two documents are needed —
                they&apos;re reviewed together.
              </p>
            </>
          ) : (
            <>
              <h2 className="text-xl font-bold text-slate-900 dark:text-white">
                Workspace pending verification
              </h2>
              <p className="mx-auto mt-2 max-w-md text-sm text-slate-500 dark:text-slate-400">
                This workspace is locked until your organization&apos;s account is verified. Please
                contact your administrator to complete the process.
              </p>
            </>
          )}
        </div>

        {isAdmin && (
          <>
            {/* Download step — only while there is still something to sign. */}
            {status !== "SUBMITTED" && !agreementUrl && (
              <div className="mt-6 rounded-xl border border-[#b48c3c]/30 bg-[#b48c3c]/5 p-4">
                <div className="flex items-start gap-3">
                  <Download className="mt-0.5 h-5 w-5 shrink-0 text-[#b48c3c]" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-slate-900 dark:text-white">
                      Download the Platform Services Agreement
                    </p>
                    <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                      Two pages. Print it, complete page 1, sign page 2, then upload the signed copy
                      below.
                    </p>
                    <a
                      href={AGREEMENT_PATH}
                      download
                      className="mt-3 inline-flex items-center gap-2 rounded-lg bg-[#0F3B3D] px-3 py-2 text-xs font-semibold text-white transition hover:bg-[#0F3B3D]/90"
                    >
                      <Download className="h-3.5 w-3.5" />
                      Download agreement (PDF)
                    </a>
                  </div>
                </div>
              </div>
            )}

            <div className="mt-4 space-y-3">
              <DocumentSlot
                kind="agreement"
                title="Signed Platform Services Agreement"
                description={`Upload the signed copy — both pages as one file. Version ${AGREEMENT_VERSION}.`}
                uploadedUrl={agreementUrl}
                onUploaded={handleUploaded}
                disabled={status === "SUBMITTED"}
              />
              <DocumentSlot
                kind="verification"
                title="Business verification document"
                description="Your invoice or other proof of business, as a PDF or image."
                uploadedUrl={verificationUrl}
                onUploaded={handleUploaded}
                disabled={status === "SUBMITTED"}
              />
            </div>

            {status === "SUBMITTED" ? (
              <div className="mt-5 flex items-center justify-center gap-2 text-xs text-slate-400">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Checking approval status…
              </div>
            ) : (
              <p className="mt-4 text-center text-xs text-slate-400 dark:text-slate-500">
                {bothUploaded
                  ? "Submitting…"
                  : "Both documents are needed before our team can review your account."}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
