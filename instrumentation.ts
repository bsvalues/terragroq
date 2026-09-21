// Explicit launcher opt-in only: source roots can also be present in builds and test processes.
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.NEXT_PHASE === "phase-production-build"
    || process.env.WILLIAMOS_APPLICATION_RECONCILE_ON_START !== "1"
    || !process.env.WILLIAMOS_APPLICATIONS_ROOT || !process.env.WILLIAMOS_APPLICATION_RUNTIME_ROOT) return
  try {
    const { reconcileApplicationsOnStartup } = await import("./lib/applications/application-runtime")
    const results = await reconcileApplicationsOnStartup()
    for (const result of results) if (result.error) console.warn("APPLICATION_STARTUP_RECONCILIATION", result.applicationId, result.observed, result.error)
  } catch { console.warn("APPLICATION_STARTUP_RECONCILIATION_UNAVAILABLE") }
}
