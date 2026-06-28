---
type: reference
status: active
area: schema
created: 2026-06-16
tags:
  - schema
  - reference
---

# Schema Reference

Complete reference for all WilliamOS note types and their required frontmatter fields.

## Content Note Types

| Type | Description | Required Fields | Template | Folder |
|------|-------------|-----------------|----------|--------|
| daily-command | Daily command note | type, date | Daily Command | 01_Daily |
| weekly-review | Weekly review note | type, week | Weekly Review | 01_Daily |
| decision | Decision record | type, status, area | Decision Record | 02_Decisions |
| doctrine | Operating principle | type, status, area | Doctrine | 03_Doctrine |
| concept | Concept or idea | type, status, area | Concept Note | 10_Ideas |
| project | Project note | type, status, area | Project Note | 11_Projects |
| work-order | Work order seed | type, status | Work Order Seed | 11_Projects |
| case | Case analysis | type, status, case_type | Case Analysis | 09_Cases |
| source | Source / reference | type, status | Source Note | 07_Learning |
| meeting | Meeting note | type, date | Meeting Note | — |
| person | Person note | type | Person | 08_People |
| learning | Learning note | type, status, area | Learning Note | 07_Learning |
| inbox | Inbox capture | type, captured | — | 00_Inbox |

## Infrastructure Note Types

| Type | Description | Required Fields |
|------|-------------|-----------------|
| readme | Folder README | type, status, area |
| moc | Map of Content | type, status |
| dashboard | Dashboard note | type, status |
| governance | Governance doc | type, status |
| policy | Policy document | type, status |
| reference | Reference document | type, status |

## Generated Artifact Types

| Type | Description | Required Fields | Location |
|------|-------------|-----------------|----------|
| inbox-triage | Inbox triage report | type, generated | 70_InboxProcessor/reports |
| weekly-synthesis | Weekly synthesis | type, week | 60_Synthesis |
| promotion-report | Promotion report | type, generated | various */reports |
| promotion-draft | Promoted draft | type, status | various */drafts |
| acceptance-plan | Acceptance plan | type, status | 98_OfficialAcceptance/plans |
| acceptance-checklist | Acceptance checklist | type, generated | 97_HumanReviewQueues/checklists |
| closure-report | Closure report | type, generated | 99_PostAcceptanceClosure/reports |
| cockpit | Cockpit dashboard | type, generated | 89_ReviewCockpit/reports |
| daily-review | Daily operating review | type, date | 96_OperatingRoutine/daily |
| weekly-operating-review | Weekly operating review | type | 96_OperatingRoutine/weekly |
| monthly-cortex-review | Monthly cortex review | type | 96_OperatingRoutine/monthly |
| cortex-review | Cortex map report | type, generated | 88_CortexMap/reports |
| backup-manifest | Backup manifest | type, generated | 92_BackupGovernance |
| restore-manifest | Restore manifest | type, generated | 93_RestoreDrill |
| release-manifest | Release manifest | type, generated | 95_ReleaseGovernance |
| maintenance-manifest | Maintenance manifest | type, generated | 100_MaintenanceRelease |
| workspace-quality | Workspace quality report | type, generated | 102_ObsidianWorkspace/reports |
| schema-report | Schema report | type, generated | 103_SchemaRegistry/reports |
