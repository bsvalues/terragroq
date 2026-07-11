# Building Permit Import Knowledge

Work Order: `WO-COUNTY-005`

## Purpose

Define a safe intake and validation model for municipal building-permit data
without reading a county share, calling a vendor, or writing to PACS.

## Intake Stages

1. **Receive.** Preserve the original file unchanged with source, sender,
   jurisdiction, received time, and hash.
2. **Classify.** Identify file type, reporting period, jurisdiction, schema
   version, and sensitivity.
3. **Profile.** Count rows, columns, blanks, duplicates, invalid dates, malformed
   identifiers, and unexpected values.
4. **Map.** Maintain explicit source-to-canonical field mappings with version
   history; never map by position alone.
5. **Transform in preview.** Normalize dates, addresses, permit types, values,
   statuses, and descriptions without altering the original.
6. **Match.** Produce candidate property matches with reason and confidence;
   ambiguous matches remain unresolved.
7. **Validate.** Separate accepted, warning, rejected, and duplicate rows.
8. **Review.** Require a human-readable preview and fallout report.
9. **Authorize.** A separate write Work Order identifies target, transaction,
   rollback, backup, and approving authority.
10. **Reconcile.** Prove written counts and exceptions against the approved
    preview.

## Required Artifacts

- immutable source-file record;
- schema fingerprint;
- mapping version;
- transformation log;
- duplicate report;
- match report;
- fallout report;
- approved preview;
- write authorization, if any;
- post-write reconciliation and rollback evidence.

## Failure Rules

- A changed city spreadsheet does not silently inherit last month’s mapping.
- A missing parcel match does not become a guessed match.
- A duplicate is not discarded without lineage.
- A partial import is not reported as complete.
- An external service failure does not trigger an unapproved fallback write.
- Fallout remains visible until disposition.

## Boundary

This page does not access the CIAPS share, vendor server, county file system,
SQL Agent, PACS database, or building-permit tables. It adds no loader,
scheduler, service, or write path.
