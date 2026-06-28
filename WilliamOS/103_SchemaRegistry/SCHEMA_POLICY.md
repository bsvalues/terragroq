---
type: policy
status: active
area: schema
created: 2026-06-16
tags:
  - schema
  - policy
---

# Schema Policy

## Scope

This policy governs the schema registry for WilliamOS note types and generated artifacts.

## Rules

1. **Read-only validation.** The schema engine reads notes and templates to validate frontmatter. It never modifies them.
2. **Schemas are defined in code.** The canonical schema list is in `scripts/williamos_schema.py`. The SCHEMA_REFERENCE.md is a human-readable copy.
3. **Templates must align.** Each schema with a declared template must have that template file in `13_Templates/`, and the template must include the required fields.
4. **Generated artifacts must have valid frontmatter.** Reports, manifests, and drafts produced by WilliamOS engines must include the fields declared by their schema.
5. **Schemas are advisory for existing notes.** The schema check does not block workflows if existing content notes are missing fields. It reports gaps.
6. **Schema additions require a code change.** New note types must be added to the SCHEMAS dict and documented in SCHEMA_REFERENCE.md.
7. **No internet, no plugins, no cloud.** Schema validation is entirely local.
