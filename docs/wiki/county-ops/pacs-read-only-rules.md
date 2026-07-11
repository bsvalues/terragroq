# PACS Read-Only Rules

Work Order: `WO-COUNTY-002`

## Purpose

Define how WilliamOS may describe PACS concepts without becoming a PACS
connector, query tool, export path, or write-back system.

## Allowed Knowledge

- table and field concepts already approved for documentation;
- generic relationships between property, value, improvement, land, sale,
  situs, owner, exemption, tax-area, and supplemental records;
- query-review checklists that do not include credentials or executable access;
- data-quality categories and reconciliation methods;
- evidence and redaction requirements;
- separation of production, training, analytics, and public datasets.

## Prohibited Content and Actions

- connection strings, hosts, usernames, passwords, tokens, DSNs, or screenshots
  of connection dialogs;
- executable production queries or instructions to bypass Windows
  authentication and county controls;
- live record values, owner names, parcel identifiers, appeal documents, or
  protected personal information;
- update, insert, delete, merge, bulk correction, schema change, trigger, agent,
  job, or write-back instructions;
- claims that a data extract is current unless its source and as-of time are
  proven;
- using a training or analytics result as production truth.

## Read-Only Review Checklist

Before an approved read-only query is used outside this documentation pack, the
separate operational Work Order must identify:

1. authorized environment and database;
2. named operator and purpose;
3. exact tables and fields;
4. whether owner or personal information is present;
5. row and date limits;
6. join cardinality and duplicate risks;
7. supplemental-year and current-record rules;
8. output destination and retention;
9. redaction and disclosure classification;
10. evidence showing no write path was used.

## Data Truth Rules

- A field name is not a business definition.
- A current value requires an explicit current-year/current-supplement rule.
- One-to-many joins must be aggregated or explained before totals are trusted.
- Sale validity, property state, and exemption status require their controlling
  codes and dates.
- Null, zero, default, and “not applicable” are not interchangeable.
- Owner data is excluded from public output unless a separate disclosure review
  authorizes it.
- Every extract must retain source, query version, as-of time, and reviewer.

## Authority Wall

This page does not authorize a PACS connection. Any actual access, query,
export, screenshot, or system inspection requires a separate owner-approved
operational packet and county controls.
