---
type: reference
status: active
area: workspace
created: 2026-06-15
tags:
  - workspace
  - tags
  - reference
---

# Tag Index

Canonical tag reference for the WilliamOS vault. Tags are optional but help with filtering and Dataview queries.

## Content Type Tags

| Tag | Used In | Purpose |
|-----|---------|---------|
| `decision` | 02_Decisions | Decision records |
| `doctrine` | 03_Doctrine | Operating principles |
| `appraisal` | 04_Appraisal | Appraisal methodology |
| `assessor` | 05_Assessor_Office | Assessor leadership |
| `strategy` | 06_TerraFusion_Strategy | Strategy notes |
| `learning` | 07_Learning | Learning notes |
| `person` | 08_People | People notes |
| `case` | 09_Cases | Case analyses |
| `concept` | 10_Ideas | Concepts and ideas |
| `project` | 11_Projects | Project notes |
| `work-order` | 11_Projects | Work order seeds |

## Status Tags

| Tag | Meaning |
|-----|---------|
| `active` | Currently in use or under development |
| `draft` | Not yet reviewed or finalized |
| `closed` | Completed or superseded |
| `archived` | Moved to cold storage |

## Domain Tags

| Tag | Domain |
|-----|--------|
| `public-trust` | Public accountability and transparency |
| `terrafusion` | TerraFusion platform |
| `valuation` | Property valuation methodology |
| `cama` | Computer-Assisted Mass Appraisal |
| `gis` | Geographic Information Systems |
| `ai` | Artificial intelligence and ML |
| `leadership` | Management and leadership |

## Process Tags

| Tag | Used For |
|-----|----------|
| `review` | Items needing human review |
| `promoted` | Promoted from inbox or synthesis |
| `generated` | Created by automation |
| `moc` | Map of Content notes |
| `dashboard` | Dashboard and index notes |

## Governance Tags

| Tag | Used For |
|-----|----------|
| `governance` | Governance policy docs |
| `policy` | Policy documents |
| `reference` | Reference materials |
| `workspace` | Workspace quality |

## Conventions

1. Use lowercase, hyphenated tags: `public-trust` not `Public Trust`
2. Prefer existing tags from this index before creating new ones
3. Place tags in YAML frontmatter, not inline `#tags`
4. Multiple tags are fine — use as many as accurately describe the note
5. Don't tag notes just for the sake of tagging — tags should aid discovery
