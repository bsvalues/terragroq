/**
 * Which model answers in the workroom, and on whose terms.
 *
 * The doctrine for this system is hybrid-sovereign: local is mandatory but not exclusive, and an
 * external provider is allowed only as a deliberate choice. Wiring the workroom straight to a cloud
 * CLI inverted that -- it made the metered provider the only option and the silent default, which is
 * how an operator with a local model and a paid subscription ended up staring at a credit error.
 *
 * So the provider is explicit, visible, and local by default. Nothing here bills anyone without the
 * operator having chosen it in front of an on-screen label saying so.
 */

export type LoomProviderId = "local" | "cloud"

export interface LoomProvider {
  id: LoomProviderId
  label: string
  /** Shown next to the choice so the cost of using it is never a surprise. */
  note: string
  /** True when using this leaves the machine. */
  external: boolean
  metered: boolean
}

export const LOOM_PROVIDERS: readonly LoomProvider[] = [
  {
    id: "local",
    label: "Local",
    note: "Runs on this machine. Nothing leaves the network and nothing is billed.",
    external: false,
    metered: false,
  },
  {
    id: "cloud",
    label: "Claude",
    note: "Stronger on large changes. Leaves the machine and uses your subscription.",
    external: true,
    metered: true,
  },
] as const

export const DEFAULT_PROVIDER: LoomProviderId = "local"

export function resolveProvider(id: unknown): LoomProvider {
  const match = LOOM_PROVIDERS.find((provider) => provider.id === id)
  // An unrecognised value resolves to local rather than to the metered provider: an accident should
  // never be what sends work off the machine.
  return match ?? LOOM_PROVIDERS.find((provider) => provider.id === DEFAULT_PROVIDER)!
}

// A coding-tuned 7B is the default because it was measured to be the smallest installed model that
// is actually dependable here: it produced a correct, verified edit on its first attempt, where the
// 4B failed all three attempts on the same task. It also fits the 6GB card, so it runs on the GPU
// rather than spilling to CPU.
export const LOCAL_MODEL = process.env.WILLIAMOS_LOCAL_MODEL ?? "qwen2.5-coder:7b"
export const LOCAL_ENDPOINT = process.env.WILLIAMOS_LOCAL_ENDPOINT ?? "http://127.0.0.1:11434"
