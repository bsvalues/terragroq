import { supportingCapabilities } from "@/components/workbench/supporting-capabilities"
import type { SystemObject, SystemObjectKind } from "@/lib/system/system-object"

/**
 * One Object + Action Registry (Gate 2, #995).
 *
 * `charter:278-279`: "`lib/intent/workbench-action-registry.ts` is the predecessor. Generalize it. Do
 * not create a second command registry." There were three, not one, and the map's §5.3 is what found
 * the third:
 *
 *   1. the navigation-target catalogue in `workbench-action-registry.ts` -- four modes plus the
 *      supporting capabilities, each with keywords and aliases;
 *   2. `router.ts`'s SIGNALS, DESTINATIONS and the action-kind union -- a second static catalogue
 *      over the same concept, with a second owner;
 *   3. `control-center/`'s 92 registered commands, which is the only one on `main` that gates
 *      execution -- and which this gate FENCES rather than absorbs (see `CONTROL_CENTER_FENCE`).
 *
 * (1) and (2) are converged here: this module owns the action-kind union, the classification signals,
 * the destinations and the descriptors, and both former owners now import from it. That is the test
 * `tests/intent-object-action-registry` enforces -- not "the files got smaller", but "the union has
 * exactly one owner". A fourth catalogue is the stop condition; a facade over this one is not a
 * catalogue.
 *
 * WHAT THIS REGISTRY IS NOT. It is not an authority. `router.ts:23` already hardcoded
 * `executionAuthorized: false` and `granted: false` before this gate, and that survives the merge
 * structurally rather than by convention: the resolution type below cannot express a granted
 * authority, so a future caller cannot set one by mistake. Authority comes from the authority system
 * or the action refuses.
 *
 * It is also not an object source. Objects arrive from `projectSystemObjects`
 * (`lib/system/system-object.ts:378`) and are passed in. A registry that could mint an object would
 * be the second System representation the map spent §4 dismantling.
 */

/**
 * The action-kind union. ONE owner, and this is it.
 *
 * The first six are `router.ts`'s, moved rather than copied. The last two are what generalizing from
 * navigation to objects requires: a registry that can only ever say "go here" cannot resolve an
 * object to an action, which is the whole of Gate 2.
 */
export type ObjectActionKind =
  | "respond"
  | "research"
  | "council_review"
  | "start_outcome"
  | "request_execution"
  | "navigate"
  | "inspect_object"
  | "mutate_object"

/**
 * What an action acts on.
 *
 * `NODE` and `ACCELERATOR` are the Gate 1a object classes and nothing else is invented beside them.
 * `project_resource` is named explicitly because `lib/resource/mutation.ts`'s operations are real,
 * catalogued and mutating -- and their subject is a resource record, NOT a node. Recording that
 * distinction is what stopped them being adopted as the first governed action
 * (`williamos-experience-v2-gate2-first-action-search-record.md` §4.3); hiding it here would undo
 * that finding one layer down.
 */
export type ActionSubject = SystemObjectKind | "workbench" | "project_resource" | "intent"

export type ObjectActionDescriptor = Readonly<{
  id: string
  kind: ObjectActionKind
  subject: ActionSubject
  label: string
  href: string | null
  keywords: readonly string[]
  /** Words an operator would actually type for this, where they differ from the label. */
  navigationAliases?: readonly string[]
  /** True when running this changes state rather than reporting it. */
  mutating: boolean
  /** The registry records that authority is needed. It never supplies it. */
  requiresAuthority: boolean
  /**
   * Where the action actually lives on `main`, or `null` when the descriptor is a destination rather
   * than an implementation. Carried so a reader can check that this catalogue describes shipped code
   * instead of intentions -- the failure mode a registry invites.
   */
  implementation: string | null
}>

// ---------------------------------------------------------------------------------------------
// Catalogue 1: navigation targets. Formerly `workbench-action-registry.ts`'s private `modes` and
// `capabilities`, verbatim in content.
// ---------------------------------------------------------------------------------------------

const NAVIGATION_DEFAULTS = { kind: "navigate", mutating: false, requiresAuthority: false, implementation: null } as const

/**
 * Projects and Activity are gone from here because they stopped being PLACES.
 *
 * The primary experience replacement deleted /projects and /activity and made both surfaces the
 * environment summons on request. Leaving them as navigation modes would have kept teaching the next
 * reader -- and the next agent -- that a capability is something you go to, which is the exact shape
 * the owner ordered removed. `mode.home` now means the environment itself.
 *
 * The capabilities below are unchanged: they still have real pages, and the ones whose pages were
 * deleted (Work Orders, Trace) keep their addresses through the redirects in `next.config.ts`, so
 * "visit work orders" still lands on the work orders.
 */
const modes: readonly ObjectActionDescriptor[] = [
  { ...NAVIGATION_DEFAULTS, id: "mode.home", subject: "workbench", label: "Home", href: "/", keywords: ["home", "overview"] },
  { ...NAVIGATION_DEFAULTS, id: "mode.system", subject: "workbench", label: "System", href: "/system", keywords: ["system", "status", "health"] },
]

const capabilityIds: Readonly<Record<string, string>> = {
  "Work Orders": "work-orders",
  Council: "council",
  Knowledge: "knowledge",
  Evidence: "evidence",
  Authority: "authority",
  Trace: "trace",
  Hermes: "hermes",
  Forge: "forge",
  "Goal Console": "goal-console",
  Workroom: "workroom",
  Lab: "lab",
  "Raw Runtime": "raw-runtime",
}

// Words the operator would actually type for a surface, where they differ from its label. The lab
// page in particular gets asked for as "the servers" or "the machines" far more often than by name.
const navigationAliasesByLabel: Readonly<Record<string, readonly string[]>> = {
  Council: ["brain council"],
  Forge: ["agent forge"],
  "Raw Runtime": ["runtime"],
  Workroom: ["loom", "work room", "workspace", "editor", "terminal"],
  Lab: ["fabric", "nodes", "machines", "servers", "the lab"],
}

const capabilities: readonly ObjectActionDescriptor[] = supportingCapabilities.map((capability) => ({
  ...NAVIGATION_DEFAULTS,
  id: `capability.${capabilityIds[capability.label]}`,
  subject: "workbench",
  label: capability.label,
  href: capability.href,
  keywords: [capability.label.toLowerCase(), capability.lens],
  navigationAliases: navigationAliasesByLabel[capability.label],
}))

// ---------------------------------------------------------------------------------------------
// Catalogue 2: object actions. Every entry describes code that already ships.
// ---------------------------------------------------------------------------------------------

/**
 * Actions whose subject is a canonical `SystemObject`.
 *
 * TWO OF THE THREE ARE READS, and the third arrived the long way round. When this registry merged,
 * all of them were reads: the bounded search this gate had to run first
 * (`docs/governance/williamos-experience-v2-gate2-first-action-search-record.md`) enumerated every
 * action on `main` whose subject can be a NODE or an ACCELERATOR and found no mutation satisfying the
 * charter's intrinsic criteria, so adding one here would have been inventing the first governed
 * mutation while claiming to have chosen it -- the overturned reversal, repeating.
 *
 * `system.node.stamp-identity` is the exception, and it is an exception with a paper trail rather
 * than an amendment to the rule. Charter `AMENDMENT-001`, under an explicit recorded owner decision,
 * permits BUILDING the first governed mutation when a bounded recorded search proves none can be
 * chosen. Two such searches ran -- the one above at `053a33bd`, and
 * `williamos-experience-v2-first-action-pickup-search-record.md` at the base this descriptor was
 * added on, which re-examined this very file first because a converged registry was the seam most
 * likely to have opened the reuse branch. Both returned nothing.
 *
 * So the reuse-first rule was not weakened; it was run twice and returned twice. A fourth descriptor
 * that mutates needs its own search, for its own subject, and `MUTATION_UNAVAILABLE` below is still
 * what an object class with no governed mutation gets.
 */
const systemObjectActions: readonly ObjectActionDescriptor[] = [
  {
    id: "system.node.inspect",
    kind: "inspect_object",
    subject: "NODE",
    label: "Inspect node",
    href: "/fabric",
    keywords: ["inspect", "probe", "check", "node", "look at"],
    navigationAliases: ["probe", "inspect"],
    mutating: false,
    requiresAuthority: false,
    // The brokered probe: unknown nodes refused, host keys pinned, recorded in the ledger.
    implementation: "app/api/fabric/nodes/route.ts",
  },
  {
    id: "system.accelerator.inspect",
    kind: "inspect_object",
    subject: "ACCELERATOR",
    label: "Inspect accelerator",
    href: "/system",
    keywords: ["inspect", "gpu", "accelerator", "vram", "card"],
    /**
     * `inspect` belongs here, and its absence made the resolver contradict its own narrowing rule.
     *
     * `phrasesFor` reads the label and these aliases -- `keywords` feed search, not matching -- so
     * `inspect RTX 3050` matched only the NODE descriptor, which was then correctly discarded because
     * no node was named. The accelerator descriptor was never considered at all, and the operator got
     * "the input named no object in the current graph" about an accelerator the graph was holding.
     * `resolveObjectAction` is written on the premise that `inspect` names BOTH actions and that the
     * object graph decides between them; this makes the catalogue agree with it, so the redundant
     * `inspect accelerator RTX 3050` is no longer the only wording that works.
     *
     * It cannot make `inspect` ambiguous by itself: these descriptors are not navigation targets
     * (`navigationDescriptors` is modes plus capabilities), and when both a node and an accelerator
     * are named the exactly-one rule refuses, which is the intended answer to a genuinely ambiguous
     * request.
     */
    navigationAliases: ["gpu", "accelerator", "inspect"],
    mutating: false,
    requiresAuthority: false,
    implementation: "lib/system/system-object.ts",
  },
  {
    id: "system.node.stamp-identity",
    kind: "mutate_object",
    subject: "NODE",
    label: "Stamp node identity",
    href: "/fabric",
    keywords: ["stamp", "identity", "record", "node", "canonical"],
    /**
     * `stamp` is the whole verb, and it is not a word this catalogue uses anywhere else.
     *
     * It deliberately does not answer to `record` or `write`, which appear in enough operator
     * sentences about evidence and files to make an accidental match on a MUTATING action plausible.
     * A navigation descriptor that answers too eagerly shows the wrong page; a mutating one that does
     * changes the wrong machine.
     */
    navigationAliases: ["stamp identity", "stamp"],
    mutating: true,
    requiresAuthority: true,
    implementation: "lib/system/node-identity-stamp.ts",
  },
]

/**
 * Catalogued mutations that exist, are correctly shaped, and are NOT SystemObject actions.
 *
 * `MUTATING_OPERATIONS` (`lib/resource/mutation.ts:21`) is the shape this registry is modelled on --
 * chosen by name and never from caller text, target from the record and never from the request,
 * unsafe input refused rather than escaped, nothing deletes. They are catalogued here because
 * converging the command catalogues means naming every mutation the application can reach, and
 * leaving them out would make this registry look complete while a mutating path ran beside it.
 *
 * They are NOT offered as node actions. Their subject is a resource record; the node in a relocation
 * is a destination field, not the thing being acted on. And the search record disqualified both on
 * the charter's own word -- `safest` -- because one moves a multi-hundred-gigabyte source and the
 * other restores a database.
 */
const resourceActions: readonly ObjectActionDescriptor[] = [
  {
    id: "resource.relocate-source",
    kind: "mutate_object",
    subject: "project_resource",
    label: "Relocate source",
    href: "/projects",
    keywords: ["relocate", "move", "source"],
    mutating: true,
    requiresAuthority: true,
    implementation: "lib/resource/mutation.ts",
  },
  {
    id: "resource.restore-database",
    kind: "mutate_object",
    subject: "project_resource",
    label: "Restore database",
    href: "/projects",
    keywords: ["restore", "database"],
    mutating: true,
    requiresAuthority: true,
    implementation: "lib/resource/mutation.ts",
  },
]

// ---------------------------------------------------------------------------------------------
// Catalogue 3 (former): the intent destinations. `router.ts` owned these; it now reads them here.
// ---------------------------------------------------------------------------------------------

export type UniversalIntent =
  | "answer"
  | "research"
  | "council"
  | "outcome"
  | "execution"
  | "navigation"

/** The classification catalogue. Regexes, in one place, with one owner. */
export const SIGNALS: Readonly<Record<Exclude<UniversalIntent, "navigation">, readonly RegExp[]>> = {
  answer: [/\banswer\b/i, /\bexplain\b/i, /\bsummar(?:ize|ise)\b/i, /\bwhat\b/i, /\bwhy\b/i, /\bhow\b/i],
  research: [/\bresearch\b/i, /\binvestigate\b/i, /\bfind out\b/i, /\bstudy\b/i],
  council: [/\bcouncil\b/i, /\bdeliberat(?:e|ion)\b/i, /\bmultiple perspectives\b/i],
  outcome: [
    /\boutcome\b/i,
    /\bgoal\b/i,
    /\bobjective\b/i,
    /\b(?:build|fix|create|make|ship|deliver|implement)\b/i,
    /^\s*add\b/i,
    /^\s*do\b/i,
  ],
  execution: [
    /\bexecute\b/i,
    /\brun\b/i,
    /\bdeploy\b/i,
    /\brestart\b/i,
    /\bmerge\b/i,
    /\bdelete\b/i,
    /\bapply\b/i,
    /\binstall\b/i,
  ],
}

export type IntentDestination = {
  href: string | null
  action: ObjectActionKind
}

export const DESTINATIONS: Readonly<Record<Exclude<UniversalIntent, "navigation">, IntentDestination>> = {
  // `/`, not `/chat`: the Line IS the conversation, and /chat was deleted rather than replaced by a
  // second place to talk. An answer belongs where the owner already is.
  answer: { href: "/", action: "respond" },
  research: { href: "/brain-council", action: "research" },
  council: { href: "/brain-council", action: "council_review" },
  outcome: { href: null, action: "start_outcome" },
  execution: { href: "/work-orders", action: "request_execution" },
}

// ---------------------------------------------------------------------------------------------
// The one registry
// ---------------------------------------------------------------------------------------------

export const objectActionRegistry: readonly ObjectActionDescriptor[] = [
  ...modes,
  ...capabilities,
  ...systemObjectActions,
  ...resourceActions,
]

/** The descriptors that are navigation targets, which is what the workbench facade still needs. */
export const navigationDescriptors: readonly ObjectActionDescriptor[] = [...modes, ...capabilities]

/**
 * The `control-center/` disposition, recorded as #995 requires: FENCE.
 *
 * Four dispositions were available -- retire, migrate, bridge, or explicitly fence -- and the map
 * declined to pre-empt the choice. This lane chose FENCE, and the reasoning is recorded rather than
 * implied:
 *
 *   - The catalogue's 92 commands act on an Obsidian vault (`scripts/williamos_commands.py:14,21`).
 *     Not one takes a node or an accelerator as its subject, so absorbing it would put 92 entries
 *     with no object class into a registry whose entire premise is resolving canonical objects.
 *   - It carries its OWN execution authority -- `allowed`, `runnable`, `confirmation_required`,
 *     `safety_tier` and `execution_path: "safety.py -> command_runner.py"`
 *     (`control-center/backend/command_center.py:136`) -- and `copilot/tools.py:52` publishes every
 *     registered command as a model-callable function schema. A registry that never grants authority
 *     cannot absorb a catalogue that does without becoming one that does.
 *   - MIGRATE and BRIDGE both route execution through that path, which would make Gate 2 the phase
 *     that dispatches work through a selector and pull `CONT-EXPV2-SELECTOR-INVENTORY` forward as a
 *     hard prerequisite -- at least five selector implementations with no evidenced call boundary.
 *     FENCE and RETIRE do not dispatch. RETIRE would delete a working operator surface on the
 *     strength of a gate that does not replace it.
 *
 * A fence is only a fence if something checks it, so `tests/intent-object-action-registry` asserts
 * that no descriptor here reaches into `control-center/` and that this module imports nothing from
 * it. Recording the disposition without enforcing it is how the third catalogue got missed twice.
 */
export const CONTROL_CENTER_FENCE = {
  disposition: "FENCE",
  boundary: ["control-center/", "scripts/williamos_commands.py"],
  reason:
    "92 commands whose subject is a vault, not a SystemObject, behind their own execution authority. " +
    "Absorbing them would make this registry an authority; routing through them would make Gate 2 a " +
    "dispatcher and pull CONT-EXPV2-SELECTOR-INVENTORY forward.",
  reconsiderWhen:
    "the selector inventory is resolved, or a control-center command acquires a SystemObject subject",
} as const

/**
 * An object class with no governed mutation says so in a type, rather than returning an empty list.
 *
 * RETYPED, AND THE PREVIOUS TEXT IS NOT LEFT TO BE READ TWO WAYS. This constant used to carry
 * `reason: "CHARTER_AMENDMENT_REQUIRED"` and mean "no `SystemObject` has a governed mutation, and
 * obtaining one is an owner decision". That is no longer true of `NODE`: the amendment was given, the
 * fresh search at the pickup base returned nothing again, and `system.node.stamp-identity` was built.
 * It remains true of `ACCELERATOR`, which is what this constant now means and all it now means.
 *
 * The narrower reason is not a downgrade. Reaching this for an accelerator is still a refusal with a
 * named condition attached -- `CONT-EXPV2-ACCELERATOR-FIRST-ACTION` requires that class to run its
 * OWN bounded recorded search before anything is built for it. The charter's reuse-first rule is not
 * spent by having been satisfied once for a different object class.
 */
export const MUTATION_UNAVAILABLE = {
  reason: "NO_CANONICAL_MUTATION_FOR_OBJECT_CLASS",
  detail:
    "No governed mutation is catalogued for this object class. Building one requires its own bounded " +
    "recorded search proving no existing canonical action qualifies for that subject -- the charter's " +
    "reuse-first rule, which survived AMENDMENT-001 intact. See " +
    "docs/governance/williamos-experience-v2-first-action-pickup-search-record.md.",
  continuation: "CONT-EXPV2-ACCELERATOR-FIRST-ACTION",
} as const

// ---------------------------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------------------------

function phrasesFor(action: ObjectActionDescriptor): readonly string[] {
  return [action.label.toLowerCase(), ...(action.navigationAliases ?? [])]
    .sort((left, right) => right.length - left.length)
}

/**
 * Every character of a phrase is literal EXCEPT a space, which is allowed to span whitespace.
 *
 * Object names are not written by this repository. They are projected from the fabric inventory --
 * hostnames, GPU vendors, GPU models -- and a real card is called `Intel(R) Arc(TM) A770`. Without
 * escaping, those parentheses became a capture group so the literal name never matched, and a name
 * containing an unmatched `[` made `new RegExp` throw and took the whole resolution down with it. A
 * registry that crashes on a legitimately-named accelerator is worse than one that cannot find it.
 *
 * The space is escaped last, so a phrase's own spaces still mean "any whitespace" while every
 * metacharacter around them stays literal.
 */
function phraseIn(phrase: string, input: string): boolean {
  const literal = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replaceAll(" ", "\\s+")
  return new RegExp(`\\b${literal}\\b`, "i").test(input)
}

/**
 * The ambiguity-refusal invariant, generalized without being weakened.
 *
 * `matchWorkbenchNavigationTarget` returned `null` unless exactly one phrase matched, and that is
 * the disambiguation discipline `charter:285-287` demands. Generalizing from navigation to mutation
 * makes it MORE important, not less: picking a winner among two plausible destinations shows the
 * operator the wrong page, and picking a winner among two plausible mutations changes the wrong
 * machine.
 */
export function matchActionPhrase(
  rawInput: string,
  within: readonly ObjectActionDescriptor[] = navigationDescriptors,
): Readonly<{ action: ObjectActionDescriptor; phrase: string }> | null {
  const input = rawInput.toLowerCase()
  const matches = within.flatMap((action) => {
    const phrase = phrasesFor(action).find((candidate) => phraseIn(candidate, input))
    return phrase ? [{ action, phrase }] : []
  })
  return matches.length === 1 ? matches[0] : null
}

export function findActions(rawQuery: string): readonly ObjectActionDescriptor[] {
  const query = rawQuery.trim().toLowerCase()
  if (query.length === 0) return navigationDescriptors
  if (query.length > 200) return []
  const tokens = query.split(/\s+/).filter(Boolean)
  return navigationDescriptors.filter((action) => {
    const haystack = `${action.label} ${action.keywords.join(" ")}`.toLowerCase()
    return tokens.every((token) => haystack.includes(token))
  })
}

// ---------------------------------------------------------------------------------------------
// Object resolution
// ---------------------------------------------------------------------------------------------

/**
 * Context. Ranking only, by construction.
 *
 * There is deliberately no field here that can name a target. `charter:285-287` says context may
 * change ranking and may not silently retarget an ambiguous mutation, and the cheapest way to keep
 * that true is to give context nothing to retarget WITH: it can say what was used recently, and that
 * is all it can say.
 */
export type ResolutionContext = Readonly<{
  /** Canonical objects, from `projectSystemObjects`. This registry has no second object source. */
  objects?: readonly SystemObject[]
  /** Recently touched object ids, most recent first. */
  recentObjectIds?: readonly string[]
  /** Recently used action ids, most recent first. */
  recentActionIds?: readonly string[]
  /**
   * The descriptors to resolve within. Defaults to the whole registry.
   *
   * This exists so the ambiguity-refusal RULE can be tested against a mutating node action, which
   * the shipped catalogue deliberately does not contain -- #995 requires that invariant proved "with
   * a mutating pair, not only a navigation pair", and the search record is why there is no shipped
   * pair to use. Supplying descriptors grants nothing: this is a pure function over a list, and
   * `executionAuthorized` is typed `false` whatever it is handed.
   */
  registry?: readonly ObjectActionDescriptor[]
}>

export type ResolutionState = "resolved" | "authority_required" | "clarification_required"

export type ObjectActionCandidate = Readonly<{
  action: ObjectActionDescriptor
  object: SystemObject | null
}>

/**
 * `executionAuthorized` and `authority.granted` are `false` as TYPES, not as values.
 *
 * This is `router.ts:23,26`'s shipped guarantee carried forward structurally. A caller cannot set
 * either to `true` without changing this type, which makes "the registry never grants authority"
 * something the compiler enforces rather than something a reviewer has to notice.
 */
export type ObjectActionResolution = Readonly<{
  state: ResolutionState
  action: ObjectActionDescriptor | null
  object: SystemObject | null
  /** Every candidate considered, ranked. Present even when one was chosen, so nothing is hidden. */
  candidates: readonly ObjectActionCandidate[]
  executionAuthorized: false
  authority: Readonly<{ required: boolean; granted: false }>
  reason: string
  /** Set only when the refusal is the absent first governed mutation. */
  unavailable?: typeof MUTATION_UNAVAILABLE
}>

function objectNames(object: SystemObject): readonly string[] {
  if (object.kind === "NODE") {
    return [object.nodeId, object.hostname, object.objectId].filter(Boolean).map((n) => String(n).toLowerCase())
  }
  return [object.objectId, object.model, object.vendor, `${object.vendor} ${object.model}`]
    .filter(Boolean)
    .map((n) => String(n).toLowerCase())
}

function matchObjects(input: string, objects: readonly SystemObject[], subject: ActionSubject): readonly SystemObject[] {
  return objects.filter((object) => object.kind === subject && objectNames(object).some((name) => phraseIn(name, input)))
}

/** Ranking is stable and explicit: recency first, then the projection's own order. */
function rankObjects(objects: readonly SystemObject[], recent: readonly string[]): readonly SystemObject[] {
  const position = (object: SystemObject) => {
    const index = recent.findIndex((id) => id === object.objectId)
    return index === -1 ? Number.MAX_SAFE_INTEGER : index
  }
  return [...objects]
    .map((object, index) => ({ object, index }))
    .sort((left, right) => position(left.object) - position(right.object) || left.index - right.index)
    .map((entry) => entry.object)
}

function refuse(reason: string, candidates: readonly ObjectActionCandidate[] = []): ObjectActionResolution {
  return {
    state: "clarification_required",
    action: null,
    object: null,
    candidates,
    executionAuthorized: false,
    authority: { required: false, granted: false },
    reason,
  }
}

/**
 * Resolve one input against the registry and the current object graph.
 *
 * The order matters and is the whole design:
 *
 *   1. exactly one action must match, or there is nothing to disambiguate the object FOR;
 *   2. an action with no object subject resolves on its own;
 *   3. an object-subject action needs objects, and zero matches is a refusal with a reason;
 *   4. **a mutating action with more than one candidate object refuses, always** -- context is not
 *      consulted, because consulting it is exactly the silent retargeting the charter forbids;
 *   5. a reading action with more than one candidate ranks them and reports every one, so a choice
 *      is visible rather than silent;
 *   6. authority is required, never granted.
 */
export function resolveObjectAction(rawInput: string, context: ResolutionContext = {}): ObjectActionResolution {
  const input = rawInput.trim()
  if (!input) return refuse("No input was provided.")

  const within = context.registry ?? objectActionRegistry
  const objects = context.objects ?? []

  // Every action whose phrase appears. Not yet a choice -- `inspect` legitimately names both the node
  // and the accelerator action, and refusing there would make the common case unusable.
  const phraseMatches = within.flatMap((action) => {
    const phrase = phrasesFor(action).find((candidate) => phraseIn(candidate, input))
    return phrase ? [{ action, phrase }] : []
  })

  /**
   * Narrow by what the object graph actually contains.
   *
   * This is NOT context ranking and the difference matters. An action on a class the input named no
   * object of cannot be the action, and the object graph is canonical truth rather than a hint about
   * the operator's habits. `inspect hermes` drops the accelerator action because no accelerator
   * matched -- deterministically, from the projection, every time.
   */
  const withObjects = phraseMatches.filter(({ action }) => {
    if (action.subject !== "NODE" && action.subject !== "ACCELERATOR") return true
    return matchObjects(input, objects, action.subject).length > 0
  })

  /**
   * A word cannot be the action and the object at the same time.
   *
   * `hermes` is a node in the fabric AND a page in the cockpit, so `inspect hermes` matched the node
   * inspect action and the Hermes capability, and the exactly-one rule then refused a request with
   * one obvious reading. The rule that settles it is not a preference between them: the input has two
   * roles to fill, and a phrase already serving as the OBJECT is not available to serve as the
   * ACTION. `open hermes` still reaches the page, because no object action matched to claim the name.
   *
   * The router has done the same thing for navigation since before this gate --
   * `withoutKnownNavigationPhrase` removes the navigation phrase before classifying the rest -- so
   * this is that discipline generalized rather than a new heuristic invented here.
   */
  const objectPhrases = new Set(
    withObjects
      .filter(({ action }) => action.subject === "NODE" || action.subject === "ACCELERATOR")
      .flatMap(({ action }) => matchObjects(input, objects, action.subject))
      .flatMap((object) => objectNames(object).filter((name) => phraseIn(name, input))),
  )

  const applicable = objectPhrases.size === 0
    ? withObjects
    : withObjects.filter(({ action, phrase }) =>
        action.subject === "NODE" || action.subject === "ACCELERATOR" || !objectPhrases.has(phrase),
      )

  if (applicable.length !== 1) {
    return refuse(
      applicable.length === 0
        ? phraseMatches.length === 0
          ? "No action in the registry matched; nothing was selected."
          : objects.length === 0
            ? "No object graph was supplied, so no canonical object could be resolved."
            : "The input named no object in the current graph."
        : "More than one action matched; no action was selected.",
    )
  }

  const action = applicable[0].action

  if (action.subject !== "NODE" && action.subject !== "ACCELERATOR") {
    return {
      state: action.requiresAuthority ? "authority_required" : "resolved",
      action,
      object: null,
      candidates: [{ action, object: null }],
      executionAuthorized: false,
      authority: { required: action.requiresAuthority, granted: false },
      reason: action.requiresAuthority
        ? "This action requires separately recorded authority; the registry grants none."
        : "One action matched and it has no object subject.",
    }
  }

  // Non-empty by construction: the narrowing above kept this action precisely because it matched.
  const candidates = matchObjects(input, objects, action.subject)
  const ranked = rankObjects(candidates, context.recentObjectIds ?? [])
  const asCandidates = ranked.map((object) => ({ action, object }))

  if (action.mutating && ranked.length > 1) {
    // The charter's own example: `restart it` with multiple plausible destructive targets requires
    // disambiguation. Ranking is deliberately computed first and then NOT used to choose, so the
    // caller can still show the operator what the options were.
    return refuse("More than one object matched a mutating action; disambiguation is required.", asCandidates)
  }

  return {
    state: action.requiresAuthority ? "authority_required" : "resolved",
    action,
    object: ranked[0],
    candidates: asCandidates,
    executionAuthorized: false,
    authority: { required: action.requiresAuthority, granted: false },
    reason: action.requiresAuthority
      ? "This action requires separately recorded authority; the registry grants none."
      : ranked.length > 1
        ? "More than one object matched a reading action; context ranked them and every candidate is reported."
        : "One action and one object matched.",
  }
}

/**
 * Ask a `SystemObject` to change, and be told why it cannot yet.
 *
 * Separate from `resolveObjectAction` because the two questions have different answers. Resolution
 * asks "what did this input name?"; this asks "is there a governed mutation for this object class at
 * all?", and on `main` the answer is a reasoned no rather than an empty list.
 */
export function resolveObjectMutation(objectKind: SystemObjectKind): ObjectActionResolution {
  const available = objectActionRegistry.filter((action) => action.subject === objectKind && action.mutating)
  if (available.length === 0) {
    return {
      ...refuse(MUTATION_UNAVAILABLE.detail),
      unavailable: MUTATION_UNAVAILABLE,
    }
  }
  return {
    state: "authority_required",
    action: available[0],
    object: null,
    candidates: available.map((action) => ({ action, object: null })),
    executionAuthorized: false,
    authority: { required: true, granted: false },
    reason: "A governed mutation exists for this object class and requires recorded authority.",
  }
}
