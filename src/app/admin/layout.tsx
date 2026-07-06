import type { ReactNode } from "react";
import Link from "next/link";

export const metadata = {
  title: "Super Admin | Aiforhomebuilder",
  description: "Super Admin portal for tenant and user management.",
};

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <header className="border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/80 backdrop-blur-sm">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <div>
            <Link
              href="/"
              className="text-lg font-semibold text-slate-900 dark:text-slate-100"
            >
              Super Admin Portal
            </Link>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Central workspace and tenant access control.
            </p>
          </div>
          <div className="flex items-center gap-3 text-sm text-slate-500 dark:text-slate-300">
            <Link
              href="/login"
              className="rounded-full border border-slate-200 bg-slate-50 px-3 py-2 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-950 dark:hover:bg-slate-900"
            >
              Shared login page
            </Link>
            <Link
              href="/admin"
              className="rounded-full bg-slate-900 px-3 py-2 text-white hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-950"
            >
              Admin dashboard
            </Link>
          </div>
        </div>
      </header>

      <main className="py-8 px-4 sm:px-6 lg:px-8">{children}</main>
    </div>
  );
}
