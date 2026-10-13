"use client";

import CrmHealthCard from "@/components/admin/CrmHealthCard";
import NewsDefaultsCard from "@/components/admin/NewsDefaultsCard";

// CRM sync health and default news feeds: the two platform-wide sales feeds.
export default function AdminIntegrationsPage() {
  return (
    <div className="grid items-start gap-6 2xl:grid-cols-[3fr_2fr]">
      <CrmHealthCard />
      <NewsDefaultsCard />
    </div>
  );
}
