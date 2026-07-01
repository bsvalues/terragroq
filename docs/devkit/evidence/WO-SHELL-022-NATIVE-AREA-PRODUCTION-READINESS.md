# WO-SHELL-022 - Native Area Production Readiness Sweep

- **artifact_id:** WO-SHELL-022
- **artifact_type:** evidence
- **claim:** The WilliamOS native-area shell sequence is production-reachable,
  validation-clean, and still bounded to UI/copy/read-only posture.
- **result:** PASS
- **verified_at:** 2026-07-01
- **main_head_before_packet:** `fc8070dc81495e0ce8aa818995b87275effd8628`

## Scope

This evidence packet closes the native-area reframe sequence covering:

- Operator Chat
- Work Orders
- Evidence
- Systems / Readiness
- Access Grants preview
- Brain Council
- Hermes Worker Dock
- Agent Forge
- Projects
- Memory
- Governance / Authority
- Doctrine
- Corpus
- Navigation consistency

This packet does not introduce feature behavior. It records production evidence
and safety posture after the UI/copy/test sequence.

## Production Route Matrix

Canonical production URL: `https://terragroq.vercel.app`

| Route | Status | WilliamOS marker | Notes |
| --- | ---: | --- | --- |
| `/api/health` | 200 | n/a | Health endpoint reachable. |
| `/api/auth/readiness` | 200 | n/a | Auth readiness endpoint reachable. |
| `/operator` | 200 | yes | Operator entry reachable. |
| `/brain-council` | 200 | yes | Brain Council area reachable. |
| Hermes Worker Dock | n/a | n/a | Native Worker Dock copy is scoped into Brain Council/Hermes preview surfaces; there is no standalone Hermes production route in this sequence. |
| `/agent-forge` | 200 | yes | Agent Forge area reachable. |
| `/projects` | 200 | yes | Projects area reachable. |
| `/memory` | 200 | yes | Memory area reachable. |
| `/governance` | 200 | yes | Governance / Authority area reachable. |
| `/doctrine` | 200 | yes | Doctrine area reachable. |
| `/corpus` | 200 | yes | Corpus area reachable. |
| `/chat` | 200 | yes | Operator Chat route reachable. |
| `/work-orders` | 200 | yes | Work Orders route reachable. |
| `/audit` | 200 | yes | Evidence route reachable. |
| `/runtime` | 200 | yes | Systems / Readiness route reachable. |
| `/access/preview` | 200 | yes | Access Grants preview route reachable. |

## Security Headers

The sampled production responses include the repo-owned baseline headers:

- `x-content-type-options: nosniff`
- `referrer-policy: strict-origin-when-cross-origin`
- `x-frame-options: DENY`
- `permissions-policy: camera=(), microphone=(), geolocation=()`
- `x-powered-by` absent

## Access Grant Boundary

Access Grants remain disabled in production.

| Endpoint | Method | Status | Expected result |
| --- | --- | ---: | --- |
| `/api/access-grants/issue` | POST | 403 | `ACCESS_GRANTS_DISABLED` |
| `/api/access-grants/accept` | POST | 403 | `ACCESS_GRANTS_DISABLED` |

Token probe submitted `wag_secret` to `/api/access-grants/accept`; the response
did not expose the raw submitted token.

## Safety Posture

Confirmed unchanged:

- No Access Grant activation
- No token issuance
- No runtime access validation
- No auth behavior or auth policy change
- No database/schema/data mutation
- No environment, package, or Vercel setting change
- No Hermes, MCP, Brain Council, or Agent Forge autonomy activation
- No scheduler or background worker activation
- No production-write behavior
- No manual deploy, release, or tag action

## Validation Results

Validation recorded for this packet:

- Focused native-area shell tests: 15 files passed, 81 tests passed
- Full test suite: 83 files passed, 367 tests passed
- `npm run build`: passed
- Production route verification: passed
- Production security-header verification: passed
- Access Grant disabled endpoint verification: passed

## Known Limits

Several authenticated shell surfaces render app-shell content after client
hydration. Raw unauthenticated HTML route probes prove route reachability and the
WilliamOS marker where present; they do not prove every authenticated in-shell
copy string is visible in raw HTML. Copy expectations are covered by the focused
component/unit tests in the native-area sequence.

## Next Recommended Goal

`GOAL-WOE-001 - Make /goal and /loop Native in WilliamOS`

The native shell is now ready for a separate governed phase that makes `/goal`
and `/loop` first-class visible operating concepts. That phase must remain
read-only/UI/copy/tests unless a specific Work Order grants broader authority.
