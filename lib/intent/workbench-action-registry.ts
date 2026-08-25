import {
  findActions,
  matchActionPhrase,
  navigationDescriptors,
  type ObjectActionDescriptor,
} from "@/lib/intent/object-action-registry"

/**
 * The navigation view of the one Object + Action Registry.
 *
 * This file used to OWN the navigation-target catalogue -- four mode descriptors plus the supporting
 * capabilities, with keywords and aliases. `charter:278-279` names it the predecessor to generalize,
 * and Gate 2 did: the descriptors now live in `object-action-registry.ts` alongside the intent
 * signals and destinations that `router.ts` used to own separately, because two static catalogues
 * over one concept was the duplication the map's §5.3 found.
 *
 * What is left here is a facade, deliberately. `components/intent/universal-intent.tsx` and
 * `tests/workbench-action-registry` import these names, and breaking callers proves nothing about
 * convergence -- a registry is one catalogue with one owner, not one import path. The test that
 * matters asserts the action-kind union has exactly one owner, and it does.
 *
 * `WorkbenchActionDescriptor` is the same shape it always was: the registry's descriptor carries
 * additional fields, and a navigation caller neither needs nor should read them.
 */

export type WorkbenchActionDescriptor = Readonly<{
  id: string
  kind: "mode" | "capability"
  label: string
  href: string
  keywords: readonly string[]
  navigationAliases?: readonly string[]
}>

function asWorkbenchDescriptor(action: ObjectActionDescriptor): WorkbenchActionDescriptor {
  return {
    id: action.id,
    // The registry keys navigation by what an action DOES; this view keys it by where it sits in the
    // cockpit, which is the distinction the ids already carried and the only reason `kind` differs.
    kind: action.id.startsWith("mode.") ? "mode" : "capability",
    label: action.label,
    href: action.href ?? "",
    keywords: action.keywords,
    ...(action.navigationAliases ? { navigationAliases: action.navigationAliases } : {}),
  }
}

export const workbenchActionRegistry: readonly WorkbenchActionDescriptor[] =
  navigationDescriptors.map(asWorkbenchDescriptor)

export function findWorkbenchActions(rawQuery: string): readonly WorkbenchActionDescriptor[] {
  return findActions(rawQuery).map(asWorkbenchDescriptor)
}

/**
 * Exactly one match, or nothing.
 *
 * The rule is unchanged and is now enforced in one place for every subject the registry knows about,
 * not only for navigation. Returning `null` on two matches is what makes `open the lab or the
 * runtime` ask rather than guess, and generalizing the registry to mutations is precisely why it had
 * to survive intact.
 */
export function matchWorkbenchNavigationTarget(rawInput: string): Readonly<{
  action: WorkbenchActionDescriptor
  phrase: string
}> | null {
  const matched = matchActionPhrase(rawInput, navigationDescriptors)
  return matched ? { action: asWorkbenchDescriptor(matched.action), phrase: matched.phrase } : null
}
