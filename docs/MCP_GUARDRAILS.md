# MCP Guardrails for WilliamOS

MCP can make the vault available to AI tools. Treat this carefully.

## Default posture

Read-only. Write access is not enabled.

```
read:   allowed with user approval
write:  denied by default
delete: forbidden
doctrine edits: suggestion-only
decision edits: suggestion-only
case edits:     suggestion-only
```

## Read access

AI assistants may read vault notes when explicitly granted filesystem or MCP access. The read scope is defined in `WilliamOS/30_MCP/READ_ONLY_SCOPE_POLICY.md`.

## Protected folders

These folders contain personal judgment and must never be written to by AI without explicit approval:

```text
WilliamOS/02_Decisions/
WilliamOS/03_Doctrine/
WilliamOS/09_Cases/
WilliamOS/05_Assessor_Office/
WilliamOS/50_Dashboards/
```

## Future safe write zones (not yet enabled)

These folders may be opened for AI writes in a future work order:

```text
WilliamOS/00_Inbox/
WilliamOS/01_Daily/
WilliamOS/90_Exports/
```

## Forbidden actions

- Delete notes
- Rewrite doctrine directly
- Rewrite decision records without approval
- Move files across folders without approval
- Create synthetic memories without source/context
- Import private external material into public exports

## Required metadata for AI-generated notes

When write access is enabled, AI-created files must include:

```yaml
generated_by: ai
source_context: explicit_user_request
created: YYYY-MM-DD
status: draft
```

## Citation rules

AI must:

- Cite note names or file paths when summarizing
- Distinguish direct note content from AI inference
- Never fabricate note content or references
- Say when nothing was found

## Recommended AI prompts

See `WilliamOS/30_MCP/SAFE_AI_PROMPTS.md` for reusable prompt templates.

### Vault Librarian

```text
Act as my WilliamOS vault librarian. Read the selected notes. Suggest missing links, duplicate concepts, stale decisions, and MOC placement. Do not modify files unless I explicitly ask.
```

### Doctrine Extractor

```text
Read these notes and extract candidate doctrines. Return them as drafts only. Do not write to 03_Doctrine unless I explicitly approve.
```

### Public Translator

```text
Turn this technical assessor note into a taxpayer-facing explanation. Preserve truth, uncertainty, and evidence. Do not overstate.
```

## MCP check

Run `python scripts/william.py mcp-check` to verify MCP readiness without requiring MCP to be installed.

## Setup

See `WilliamOS/30_MCP/MCP_SETUP.md` for configuration options.
