# Hermes Safety Classification Matrix

This matrix classifies future Hermes Worker Packets. It is a static planning tool, not an executable risk scanner or permission system.

| Risk class | Allowed by default | Owner authority required | Evidence required | Validation required | Examples | Blocked examples |
| --- | --- | --- | --- | --- | --- | --- |
| `READ_ONLY_DOCS` | Yes, in docs lanes | No, if inside scoped Work Order | Files changed and diff check | Docs/static tests | Update doctrine copy | Runtime loader |
| `READ_ONLY_REPO_INSPECTION` | No for Hermes runtime | Yes | Scope and inspection transcript | Read-only validation | Inspect static files | Filesystem scanner worker |
| `LOCAL_TEST_ONLY` | No | Yes | Test scope and expected results | Focused/local tests | Run approved tests | Hidden worker test runner |
| `CODE_MODIFICATION` | No | Yes | PR, tests, safety proof | Full suite/build | Scoped code edit | Broad refactor |
| `GIT_WRITE` | No | Yes | Branch/commit/PR evidence | PR checks | Commit authorized slice | UI-triggered git write |
| `PR_MERGE` | No | Yes | Green checks and review status | PR checks | Merge approved PR | Auto-merge from Hermes |
| `DEPLOYMENT` | No | Yes | Deploy packet and rollback | Production checks | Future deploy gate | Production deploy here |
| `DB_SCHEMA` | No | Yes | Migration packet | DB validation | Future migration gate | Schema change here |
| `PRODUCTION_WRITE` | No | Yes | Production-write authority | Production validation | Future explicit write | Hidden production write |
| `AUTH_POLICY` | No | Yes | Auth design packet | Auth tests | Future auth gate | Auth policy mutation here |
| `SECRET_ACCESS` | No | Yes | Secret handling packet | Redaction proof | Future secret gate | Printed secret |
| `NETWORK_ACCESS` | No | Yes | Network boundary | Connectivity proof | Future limited endpoint | Open LAN/public access |
| `COMMAND_EXECUTION` | No | Yes | Command authority packet | Command audit | Future explicit command | Command runner here |
| `AUTONOMY_OR_SCHEDULER` | No | Yes | Autonomy authority packet | Runtime safety proof | Future bounded worker | Always-on scheduler |

Default for this batch: only doctrine and static docs are allowed. Everything else is future-scoped and blocked.

