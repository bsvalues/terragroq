// Next.js instrumentation hook. The Vercel-specific `@vercel/otel` wrapper was removed as part of
// de-Vercel'ing the stack (the app self-hosts via `output: "standalone"`). This stays a no-op until
// a vendor-neutral OpenTelemetry provider is wired here (e.g. `@opentelemetry/sdk-node` with an OTLP
// exporter driven by `OTEL_EXPORTER_OTLP_ENDPOINT`). Kept so the instrumentation entrypoint exists.
export function register(): void {
  // no telemetry provider configured
}
