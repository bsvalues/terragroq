import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // SAMEORIGIN, not DENY: the Environment's browser surface frames the running application's own
          // pages (a surface IS the real thing). Foreign origins remain refused.
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          // A deliberately PARTIAL CSP (independent review, 2026-08-20). It carries only the
          // directives that need no nonce and touch no subresource loading, so it hardens the
          // model-rendered Surfaces (base-tag injection, plugin vectors, form-exfil, clickjacking)
          // without risking Next's inline hydration bootstrap. A full script-src/style-src policy
          // needs nonce plumbing through the App Router and is its own change -- NOT rushed in here,
          // and its absence is intentional, not forgotten.
          {
            key: "Content-Security-Policy",
            value: "base-uri 'self'; object-src 'none'; frame-ancestors 'self'; form-action 'self'",
          },
        ],
      },
    ]
  },
};

export default nextConfig;
