import provenance from "@/lib/generated/build-provenance.json"

/**
 * The commit this artifact was built from, baked in at build time by scripts/write-build-provenance.mjs
 * and imported here by value so it travels inside the standalone bundle. The health route exposes it
 * and the deploy verifies the running instance reports the exact commit that was built (#762 deploy
 * doctrine). `sha` is "development" in the committed placeholder and "unknown" when the build could
 * not resolve a commit -- both of which the deploy check treats as UNPROVEN, never as a match.
 */
export type BuildProvenance = Readonly<{ sha: string; builtAt: string | null }>

export function getBuildProvenance(): BuildProvenance {
  return { sha: provenance.sha, builtAt: provenance.builtAt }
}
