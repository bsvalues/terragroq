---
type: governance
status: accepted
tags:
  - maintenance
  - tagging
  - policy
  - governance
---

# Tagging Policy

## What a Tag Is

A Git tag is a named reference to a specific commit. Annotated tags include a message and timestamp. WilliamOS uses annotated tags to mark release and maintenance milestones.

## Tag Format

```
vMAJOR.MINOR.PATCH
```

Examples:
- `v1.0.0` — initial release (WO-001 through WO-016)
- `v1.1.0` — first maintenance release (WO-017 through WO-020)

## Tag Creation Rules

1. **Working tree must be clean.** Commit or stash all changes before tagging.
2. **Maintenance checks must pass.** Run `maintenance-review` first. Blocking failures prevent tagging.
3. **No forbidden files.** The forbidden file scan must find nothing.
4. **No remotes.** The remote scan must find zero configured remotes.
5. **No duplicate tags.** A tag name that already exists will be rejected.
6. **Tags are local only.** Never push tags to a remote.
7. **Tags are permanent.** Do not delete or move tags after creation.

## Tag Workflow

```bash
# 1. Run maintenance review
python scripts/william.py maintenance-review

# 2. Create snapshot if needed
python scripts/william.py snapshot --message "WilliamOS v1.1 maintenance baseline"

# 3. Preview tag
python scripts/william.py maintenance-tag --name v1.1.0 --dry-run

# 4. Create tag
python scripts/william.py maintenance-tag --name v1.1.0

# 5. Do NOT push
```

## No-Push Rule

Tags created by the maintenance engine are never pushed. There is no `--push` flag and no push shortcut. If you later configure a remote and choose to push, that is a separate manual decision outside this engine.

## Tag Message Format

The tag message is automatically generated:

```
WilliamOS v1.1.0 — maintenance release (WO-017 through WO-020)
```
