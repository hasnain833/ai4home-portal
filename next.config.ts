import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
