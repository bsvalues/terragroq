# Reference — Doctrine

Doctrine is WilliamOS's machine-readable rulebook. It comes in two layers:

1. **Constitutional doctrine** — hard-coded, machine-checkable rules evaluated by
   the classifier on every goal (`lib/governance/doctrine-rules.ts`, WO-015).
2. **Operator doctrine** — editable rules stored in the `doctrine` register and
   managed through the `/doctrine` surface.

---

## Constitutional doctrine (WO-015)

`checkDoctrineRules({ intent, authority, activeLocks, phase6Authorized })` runs
inside `classifyGoal()` and returns a verdict plus any violations:

- `verdict: "forbidden"` → the goal is **refused** regardless of lane. Risk is
  forced to `critical`.
- `verdict: "requires_approval"` → the goal is **gated** behind explicit approval.
- `verdict: "allowed"` → no constitutional rule blocks it.

When there is a violation and the verdict isn't `allow`, the classifier uses the
violation's `safeAlternative` as the recommended next move, so the operator is
always told what they *can* do instead.

These rules are not editable from the UI — they are constitutional. Changing them
is a code change, reviewed and tested.

---

## Operator doctrine register

The `doctrine` table holds editable operating rules. Each rule:

| Field | Meaning |
| ----- | ------- |
| `ref` | `RULE-0001` style reference. |
| `title`, `statement` | The rule. |
| `category` | `principle \| policy \| guardrail`. |
| `scope`, `priority` | Where it applies and ordering. |
| `status` | `active \| superseded \| retired`. |
| `active` | Whether it is currently enforced. |
| `allowed`, `forbidden`, `requiresApproval` | Structured action lists. |
| `evidence` | Supporting links. |
| `locked` | Seeded governance doctrine that should not be casually deleted. |
| `supersedesId` / `supersededById` | Lineage. |

Actions in `app/actions/doctrine.ts`:

| Action | Effect |
| ------ | ------ |
| `getDoctrine()` / `getActiveDoctrine(userId)` | List rules. |
| `searchDoctrine(query)` | Search. |
| `createDoctrine(input)` | Add a rule. |
| `toggleDoctrine(id, active)` | Enable/disable enforcement. |
| `supersedeDoctrine(...)` | Replace a rule, preserving lineage. |
| `linkDoctrineEvidence(id, evidence)` | Attach evidence. |
| `validateAction(action)` | Check an action string against active doctrine → a verdict. |
| `seedGovernanceDoctrine()` | Install the locked baseline rules. |
| `deleteDoctrine(id)` | Remove a (non-locked) rule. |

---

## How doctrine relates to the rest of the system

- The **classifier** consults constitutional doctrine on every goal.
- The **loop engine** stops a loop when its `doctrineVerdict` is `forbidden`
  (highest-priority stop condition).
- **Decisions** (`decision` register) record *why* a rule exists; binding decisions
  are injected into agent context. Doctrine records *what the rule is*.
- **Locks** (`lock_record`) can change the active posture that constitutional
  doctrine evaluates against (e.g. a FREEZE forbids more).

Together they form the rule system: decisions explain, doctrine enforces, locks
constrain posture, and the classifier applies all three deterministically.
