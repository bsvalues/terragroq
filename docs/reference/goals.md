# Reference — Goals & the Classifier

The Goal Console (`/goal-console`) is the primary surface of WilliamOS. It turns a
raw operator command into a deterministic classification before any work happens.

- **Engine:** `lib/goal/classifier.ts` (pure), `lib/goal/taxonomy.ts`, `lib/goal/mistake-patterns.ts`
- **Actions:** `app/actions/goals.ts`
- **Table:** `goal`

---

## What classification produces

`classifyGoal(command, ctx?)` returns a `Classification`:

| Field | Meaning |
| ----- | ------- |
| `lane` | One of 8 lanes — *what kind* of work this is. |
| `mode` | One of 7 modes — *how* it should proceed. |
| `risk` | `low \| medium \| high \| critical`. |
| `authority` | The required authority level A0–A9. |
| `verdict` | `allow \| requires_approval \| refuse`. |
| `rationale` | Human-readable explanation of the decision. |
| `recommendedMove` | The next valid action. |
| `requiresApproval` | True when verdict is `requires_approval`. |
| `mistakePatterns` | Matched MP-001…MP-010 entries. |
| `doctrineViolations` | Matched constitutional doctrine rules. |

---

## How the decision is made

1. **Lane detection** — `LANE_SIGNALS` regexes are tested in order; the first
   strong match wins. Default (no match) is `read_model` — the safest, read-only
   assumption.
2. **Mode detection** — `MODE_SIGNALS` in order; default is `inspect`.
3. **Authority derivation** — `deriveAuthority(lane, mode)`:
   - `inspect`/`plan`/`verify`/`review` → `A0_READ_ONLY` regardless of lane.
   - `draft` → `A1_DRAFT`.
   - `operate` → `A9_RELEASE` for the release lane, else `A7_COMMIT`.
   - `implement` → the lane's `LANE_MAX_AUTHORITY` ceiling.
4. **Mistake patterns** — `matchMistakePatterns()` scans for the 10 recurring
   failure modes. `warn` escalates risk; `block` forces a refusal.
5. **Doctrine** — `checkDoctrineRules()` evaluates constitutional rules against the
   command, derived authority, and active locks. `forbidden` forces refusal;
   `requires_approval` gates.
6. **Risk** — starts at the lane baseline, escalates per blocking/warn pattern and
   when authority rank ≥ 5; any forbidden doctrine makes it `critical`.
7. **Verdict** —
   - `refuse` if any blocking pattern matched or doctrine is forbidden.
   - `requires_approval` if authority > A1 or doctrine requires approval.
   - otherwise `allow`.

Because every step is a pure function of the input text (plus asserted context),
the same command always yields the same classification. This is what makes the
console auditable.

---

## Mistake patterns (MP-001…MP-010)

Defined in `lib/goal/mistake-patterns.ts`. Each has signals, a severity, and
guidance:

| ID | Title | Severity |
| -- | ----- | -------- |
| MP-001 | Acting without a work order | warn |
| MP-002 | Silent scope creep | warn |
| MP-003 | Destructive op without backup | **block** |
| MP-004 | Touching auth or secrets casually | warn |
| MP-005 | Release action mid-task | warn |
| MP-006 | Assuming instead of verifying | warn |
| MP-007 | Bypassing doctrine | **block** |
| MP-008 | Phase-6 / production rollout | **block** |
| MP-009 | No validators / acceptance criteria | warn |
| MP-010 | Irreversible without confirmation | warn |

---

## Goal lifecycle

A `goal` row moves through: `classified` → (`converted` | `dismissed`).

Server actions in `app/actions/goals.ts`:

| Action | Effect |
| ------ | ------ |
| `submitGoal(command)` | Classifies and persists a new goal. |
| `getGoals()` | Lists the user's goals. |
| `getCurrentTruth()` | The Current Truth panel data (`lib/goal/current-truth.ts`). |
| `runLoop(goalId)` | Runs the read/verify loop for an allowed goal and reports findings. |
| `attemptExecute()` | Always returns a refusal — execution is never implicit from a goal. |
| `convertGoalToWorkOrder(goalId)` | Promotes a gated goal into a draft work order. |
| `dismissGoal(goalId)` | Marks a goal dismissed. |

`attemptExecute()` exists on purpose: it demonstrates and enforces that a goal —
even an allowed one — never carries execution authority by itself. Execution only
happens via an approved work order under an explicit authority grant.
