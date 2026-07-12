# WO-RUNTIME-IDENTITY-021 - Append-Only Audit Ledger

Native JSONL records chain timestamp, event, sanitized fields, previous hash,
and current SHA-256 hash. Verification detects broken links and modified
records. Prompts, patches, auth output, environment dumps, and secret-like
fields are prohibited. Local retention is owner-controlled; export consists
only of a verified copy of the sanitized ledger.

Live verification: `AUDIT_STATUS=VALID`.
