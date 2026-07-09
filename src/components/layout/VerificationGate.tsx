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
  FileImage,
  AlertCircle,
} from "lucide-react";

// Overlay shown on top of the (blurred) warranty workspace while a tenant is
// awaiting document verification. The company admin uploads a document; the
// Super Admin reviews it and unlocks the workspace.
export default function VerificationGate() {
  const { user, refreshUser } = useAuth();
  const [status, setStatus] = useState<string>(
    user?.verificationStatus || "PENDING",
  );
  const [docUrl, setDocUrl] = useState<string | null>(
    user?.verificationDocUrl || null,
  );
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isAdmin = user?.role === "admin";

  // Poll for approval so the workspace unlocks without a manual reload once the
  // Super Admin verifies the tenant.
  useEffect(() => {
    if (status === "VERIFIED") return;
    const interval = setInterval(async () => {
      const updated = await refreshUser();
      if (updated?.verificationStatus === "VERIFIED") {
        clearInterval(interval);
      }
    }, 20000);
    return () => clearInterval(interval);
  }, [status, refreshUser]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    setError(null);
    const selected = e.target.files?.[0];
    if (!selected) return;
    if (!selected.type.startsWith("image/")) {
      setError("Please select an image file (JPG, PNG, etc.).");
      return;
    }
    if (selected.size > 10 * 1024 * 1024) {
      setError("File is too large. Maximum size is 10 MB.");
      return;
    }
    setFile(selected);
    setPreview(URL.createObjectURL(selected));
  };

  const handleSubmit = async () => {
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const response = await fetch("/api/company/verification", {
        method: "POST",
        body: formData,
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.message || "Upload failed. Please try again.");
      }
      const data = await response.json();
      setStatus(data.verificationStatus || "SUBMITTED");
      setDocUrl(data.verificationDocUrl || preview);
      setFile(null);
      setPreview(null);
      // Refresh the shared user so status persists across navigation.
      refreshUser();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setUploading(false);
    }
  };

  if (status === "VERIFIED") return null;

  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center overflow-auto p-4">
      <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white/95 p-6 text-center shadow-2xl backdrop-blur-xl dark:border-slate-700 dark:bg-slate-900/95 sm:p-8">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-[#0F3B3D]/10 text-[#0F3B3D] dark:bg-[#0F3B3D]/30 dark:text-[#a0c5c7]">
          {status === "SUBMITTED" ? (
            <Clock className="h-7 w-7" />
          ) : (
            <ShieldCheck className="h-7 w-7" />
          )}
        </div>

        {status === "SUBMITTED" ? (
          <>
            <h2 className="text-xl font-bold text-slate-900 dark:text-white">
              Verification in review
            </h2>
            <p className="mx-auto mt-2 max-w-md text-sm text-slate-500 dark:text-slate-400">
              Thanks! Your document has been submitted. Our team is reviewing it
              and your Warranty Care workspace will unlock automatically once
              it&apos;s approved.
            </p>

            {docUrl && (
              <div className="mx-auto mt-5 max-w-xs overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={docUrl}
                  alt="Submitted verification document"
                  className="max-h-48 w-full object-contain bg-slate-50 dark:bg-slate-800"
                />
              </div>
            )}

            <div className="mt-6 flex items-center justify-center gap-2 text-xs text-slate-400">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Checking approval status…
            </div>

            {isAdmin && (
              <Button
                variant="ghost"
                size="sm"
                className="mt-4 text-slate-500"
                onClick={() => {
                  setStatus("PENDING");
                  setDocUrl(null);
                }}
              >
                Upload a different document
              </Button>
            )}
          </>
        ) : isAdmin ? (
          <>
            <h2 className="text-xl font-bold text-slate-900 dark:text-white">
              Verify your account to continue
            </h2>
            <p className="mx-auto mt-2 max-w-md text-sm text-slate-500 dark:text-slate-400">
              Your Warranty Care workspace is locked while we verify your
              business. Please upload a clear photo or scan of your verification
              document (e.g. business license or invoice) and submit it for
              review.
            </p>

            <div className="mt-6">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleFileSelect}
              />

              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-slate-500 transition hover:border-[#b48c3c] hover:bg-[#b48c3c]/5 dark:border-slate-600 dark:bg-slate-800/40 dark:text-slate-400"
              >
                {preview ? (
                  <>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={preview}
                      alt="Document preview"
                      className="max-h-40 rounded-md object-contain"
                    />
                    <span className="mt-1 flex items-center gap-1.5 text-xs font-medium text-[#b48c3c]">
                      <FileImage className="h-3.5 w-3.5" />
                      {file?.name} — click to change
                    </span>
                  </>
                ) : (
                  <>
                    <UploadCloud className="h-8 w-8" />
                    <span className="text-sm font-semibold">
                      Click to upload a document image
                    </span>
                    <span className="text-xs">JPG or PNG, up to 10 MB</span>
                  </>
                )}
              </button>
            </div>

            {error && (
              <div className="mt-3 flex items-center justify-center gap-1.5 text-sm text-red-600 dark:text-red-400">
                <AlertCircle className="h-4 w-4" />
                {error}
              </div>
            )}

            <Button
              onClick={handleSubmit}
              disabled={!file || uploading}
              className="mt-6 w-full bg-[#0F3B3D] font-semibold text-white hover:bg-[#0F3B3D]/90"
            >
              {uploading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Submitting…
                </>
              ) : (
                <>
                  <CheckCircle2 className="mr-2 h-4 w-4" />
                  Submit for verification
                </>
              )}
            </Button>
          </>
        ) : (
          <>
            <h2 className="text-xl font-bold text-slate-900 dark:text-white">
              Workspace pending verification
            </h2>
            <p className="mx-auto mt-2 max-w-md text-sm text-slate-500 dark:text-slate-400">
              This workspace is locked until your organization&apos;s account is
              verified. Please contact your administrator to complete the
              verification process.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
