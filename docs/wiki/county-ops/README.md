# County Ops Knowledge Map

Work Order: `WO-COUNTY-001`

County Ops is the static, governed reference layer for Washington county
assessor operations. It organizes doctrine and packet structure; it does not
connect to county systems or store case data.

## Knowledge Areas

| Area | Reference | Governing question |
|---|---|---|
| PACS safety | [PACS read-only rules](pacs-read-only-rules.md) | What may be documented without touching PACS? |
| Levy | [Levy workflow](levy-workflow.md) | What evidence should accompany a levy calculation and certification? |
| BOE | [BOE evidence](boe-evidence.md) | How should an appeal record separate claims, evidence, analysis, and authority? |
| Permits | [Permit import](permit-import.md) | How should permit intake be mapped, validated, and held before any write? |
| Public data | [Public-data redaction](public-data-redaction.md) | What must be reviewed before information is published or shared? |
| Ratio studies | [Ratio-study knowledge](ratio-study.md) | What makes a ratio analysis reproducible and reviewable? |
| Appeals | [Appeals packet](appeals-packet.md) | What belongs in a complete, neutral case-preparation packet? |

## Common Evidence Spine

Every County Ops reference should preserve:

- purpose and authority;
- source and as-of date;
- data classification;
- assumptions and exclusions;
- calculation or transformation lineage;
- reviewer and review state;
- exceptions and unresolved contradictions;
- final disposition;
- rollback or correction path where relevant.

## Source Hierarchy

1. current Washington Constitution, RCW, and WAC;
2. current Washington Department of Revenue publications and advisories;
3. controlling court or Board of Tax Appeals authority;
4. adopted county policy and counsel direction;
5. approved procedure;
6. training reference;
7. historical example.

A lower source does not override a higher source. A stale source is evidence of
history, not current authority.

## Boundary

No page in this directory contains a PACS connection, query, credential, parcel
record, taxpayer record, owner name, appeal record, permit record, exemption
record, production screenshot, or copied county log.

If a task requires any of those items, the County Ops documentation loop stops
at a typed authority wall.
