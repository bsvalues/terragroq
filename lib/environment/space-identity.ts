/**
 * Which Project a Space belongs to, decided by the Project — not by a regex over strings.
 *
 * The Space's identity was inferred by matching `/terrafusion|terragroq/i` against a world's intent
 * and its resource strings. So a world whose resources merely CONTAINED the substring "terragroq"
 * was treated as the TerraFusion Space, and new worlds were created from the literal string
 * "TerraFusion". That is the "TerraFusion by configuration, not construction" defect at the identity
 * layer: the screen can say TerraFusion while the world beneath it is something else, and nothing is
 * in a position to disagree.
 *
 * A world already carries `spine.projectId`. When it is present, THAT is the identity — an integer
 * match against the bound Project, not a fuzzy string test. The regex survives only as an explicit
 * fallback for legacy worlds saved before the spine carried a projectId, and is named as such so it
 * cannot quietly become the primary rule again.
 *
 * Pure, so the rule is tested without a store.
 */

export interface ProjectIdentity {
  id: number
  key: string
  name: string
}

export interface WorldIdentityFields {
  /** The Project the world's spine is bound to. Null on legacy worlds saved before it existed. */
  projectId: number | null
  projectName: string | null
  intent: string
  resources: readonly string[]
}

/**
 * Whether a world is the Space for a given Project.
 *
 * By projectId when the world has one. Only a world with NO projectId falls back to the legacy
 * string test, and even then only against the intended Project's own name/key — never a blanket
 * "looks like TerraFusion".
 */
export function worldMatchesProject(world: WorldIdentityFields, project: ProjectIdentity): boolean {
  if (world.projectId != null) return world.projectId === project.id
  return legacyStringMatch(world, project)
}

/**
 * The legacy fallback, quarantined behind a name that says what it is. Matches a legacy world by the
 * intended Project's registered key or name, case-insensitively, as a whole token — NOT a substring,
 * so a world mentioning "terragroq" no longer passes as TerraFusion.
 */
export function legacyStringMatch(world: WorldIdentityFields, project: ProjectIdentity): boolean {
  const needles = [project.key, project.name]
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
  const hay = [world.intent, world.projectName ?? "", ...world.resources]
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
  return needles.some((needle) => hay.includes(needle))
}

/**
 * The intent/name a NEW world for this Project should carry.
 *
 * The Project's registered name, not the literal "TerraFusion". A Space created for LocalOps must
 * not be born calling itself TerraFusion.
 */
export function spaceIntentForProject(project: ProjectIdentity): string {
  return project.name
}
