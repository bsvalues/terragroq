---
type: reference
status: active
area: workspace
created: 2026-06-15
tags:
  - workspace
  - reference
---

# Folder README Guide

Every content folder (00_Inbox through 12_Maps) should have a README.md that orients the reader.

## README Format

```markdown
---
type: readme
status: active
area: [folder area]
created: YYYY-MM-DD
tags:
  - readme
---

# [Folder Name]

[One sentence: what goes here.]

## What Belongs Here

- [Bullet list of note types]

## Template

Use the [[Template Name]] template to create new notes.

## Related

- [[MOC link]]
- [[Related folder README]]
```

## Rules

1. **Keep it short.** A README is orientation, not documentation.
2. **Link to the relevant template.** Help the user create the right kind of note.
3. **Link to the relevant MOC.** Help the user find related context.
4. **Don't list every note.** That's what the file explorer and Dataview are for.
5. **READMEs are not automation targets.** The workspace engine checks that they exist but never modifies them.
