import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  /**
   * Superseded routes keep their addresses.
   *
   * The primary experience replacement deleted six legacy pages (/activity, /chat, /decisions,
   * /projects, /trace, /work-orders) and collapsed the two predecessor environment roots (/env from
   * #919, /environment from #922) into `/`. Ninety-three links across thirty-five surviving files
   * still point at those addresses, and every one of them would have become a 404 the moment this
   * landed -- the deletion would have removed the capability from the operator even though the
   * environment can summon it.
   *
   * So the addresses survive as redirects into the environment, carrying WHICH surface was asked
   * for. `?summon=` is not a second navigation model: it is the same summon the Line performs,
   * reached from a link instead of a sentence, and `tests/summoned-route-redirects.test.ts` pins
   * every pair so a renamed surface cannot silently strand a route.
   *
   * /chat carries no surface because the Line replaced it: chat is not a thing you open here, it is
   * how you speak to the environment.
   */
  async redirects() {
    return [
      { source: "/work-orders", destination: "/?summon=work-orders", permanent: true },
      { source: "/decisions", destination: "/?summon=decisions", permanent: true },
      { source: "/trace", destination: "/?summon=runtime-trace", permanent: true },
      { source: "/activity", destination: "/?summon=activity", permanent: true },
      { source: "/projects", destination: "/?summon=project", permanent: true },
      { source: "/chat", destination: "/", permanent: true },
      { source: "/env", destination: "/", permanent: true },
      { source: "/environment", destination: "/", permanent: true },
    ]
  },
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
