---
type: governance
status: active
area: schema
created: 2026-06-16
tags:
  - schema
  - governance
---

# 103_SchemaRegistry

Schema registry for all WilliamOS note types and generated artifact types.

## Purpose

Defines required frontmatter fields for every note type. Validates templates and generated artifacts against their schemas. Never modifies source notes.

## What This Layer Does

- Defines 35+ note type schemas with required fields
- Validates templates match their declared schema
- Validates generated artifacts have correct frontmatter
- Generates schema reports

## What This Layer Does NOT Do

- Modify source notes
- Enforce schemas on existing notes (advisory only)
- Require Obsidian plugins
- Connect to cloud or remote

## Files

- `README.md` — this file
- `SCHEMA_POLICY.md` — rules for schema validation
- `SCHEMA_REFERENCE.md` — complete schema reference table

## Commands

```bash
python scripts/william.py schema-status       # schema registry summary
python scripts/william.py schema-check        # validate schemas and templates
python scripts/william.py schema-report       # generate full schema report
python scripts/william.py schema-report --dry-run  # preview without writing
```

## Engine

- `scripts/williamos_schema.py` — schema registry and validation engine
