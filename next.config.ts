import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: { proxyTimeout: 120_000 },
  async rewrites() {
    return process.env.NODE_ENV === "development" && process.env.BACKEND_URL
      ? [
          {
            source: "/api/:path*",
            destination: `${process.env.BACKEND_URL}/api/:path*`,
          },
        ]
      : [];
  },
  async redirects() {
    return [
      // Admin pages merged into Companies / CRM & News / Usage & Costs.
      { source: "/admin/users", destination: "/admin/companies", permanent: true },
      { source: "/admin/verifications", destination: "/admin/companies", permanent: true },
      { source: "/admin/crm-health", destination: "/admin/integrations", permanent: true },
      { source: "/admin/news-defaults", destination: "/admin/integrations", permanent: true },
      { source: "/admin/messaging", destination: "/admin/costs", permanent: true },
      {
        source: "/tickets",
        destination: "/warranty/tickets",
        permanent: true,
      },
      {
        source: "/tickets/:id",
        destination: "/warranty/tickets/:id",
        permanent: true,
      },
      {
        source: "/chat",
        destination: "/warranty/chat",
        permanent: true,
      },
      {
        source: "/knowledge-base",
        destination: "/warranty/knowledge-base",
        permanent: true,
      },
      {
        source: "/company",
        destination: "/warranty/company",
        permanent: true,
      },
      {
        source: "/properties",
        destination: "/warranty/properties",
        permanent: true,
      },
      {
        source: "/reports",
        destination: "/warranty/reports",
        permanent: true,
      },
      {
        source: "/integrations",
        destination: "/warranty/integrations",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
