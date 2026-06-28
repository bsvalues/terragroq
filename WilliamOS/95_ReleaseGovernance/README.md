# Release Governance

WilliamOS release governance layer. Manages acceptance reviews, release manifests, and local Git tags.

## What this layer does

- Runs full-system acceptance checks across all WO layers
- Generates acceptance reports with pass/warning/fail classification
- Writes release manifests summarizing system state
- Creates local annotated Git tags when acceptance passes
- Tracks release history via reports and data files

## What this layer does NOT do

- Push to any remote
- Create remotes
- Upload notes or data
- Modify source notes
- Auto-commit changes
- Publish releases externally
- Require internet access

## Commands

| Command | Purpose |
|---|---|
| `release-status` | Show release governance status |
| `acceptance --dry-run` | Preview acceptance checks without writing |
| `acceptance` | Run acceptance and generate report |
| `release-manifest` | Generate/update release manifest |
| `release-tag --name v1.0.0 --dry-run` | Preview tag creation |
| `release-tag --name v1.0.0` | Create local annotated tag |

## File index

| File | Purpose |
|---|---|
| README.md | This overview |
| ACCEPTANCE_POLICY.md | What acceptance means and how it works |
| V1_ACCEPTANCE_CHECKLIST.md | Full v1 acceptance checklist |
| RELEASE_TAG_POLICY.md | Tagging rules and constraints |
| POST_RELEASE_ROUTINE.md | What to do after a release |
| RELEASE_MANIFEST.md | Auto-generated release state (committed with tags) |
| reports/ | Generated acceptance review reports |
| data/ | Generated acceptance data JSON files |

## Engine

`scripts/williamos_release.py` — release governance engine (deterministic checks, no cloud, no AI)
