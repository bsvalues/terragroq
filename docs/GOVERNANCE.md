# WilliamOS Governance

## Boundary Rule

WilliamOS is separate from TerraFusion.

- TerraFusion Brain governs product truth, code, work orders, CI, drift, and repo state.
- WilliamOS governs personal judgment, learning, doctrine, public trust thinking, appraisal expertise, assessor leadership, and strategy.

Do not place WilliamOS inside a TerraFusion repo.
Do not let TerraFusion agents edit WilliamOS by default.

## AI Write Rules

AI assistants may read notes when explicitly allowed.

AI assistants may write only to:

```text
00_Inbox/
01_Daily/
90_Exports/
```

AI assistants may not modify these without explicit approval:

```text
02_Decisions/
03_Doctrine/
09_Cases/
```

AI assistants may never delete notes.

## Doctrine Rules

Doctrine is not casual writing. A doctrine note must include:

- Rule
- Meaning
- Applies to
- Violations
- Related notes

Doctrine should be reviewed, not auto-generated directly into canonical form.
Candidate doctrine can be captured in `00_Inbox/` or `10_Ideas/` first.

## Decision Rules

Important decisions get a decision record.

A decision record must include:

- Decision
- Why
- Alternatives considered
- Risks
- Revisit condition/date
- Links

Never keep re-litigating a decision without updating its decision record.

## Weekly Review Rules

Every week:

1. Process inbox.
2. Review open loops.
3. Identify stale decisions.
4. Promote repeated insights into candidate doctrine.
5. Commit the vault to Git.

## Graphify Rules

Graphify is for insight, not decoration.

Monthly Graphify review should answer:

- What are my central ideas?
- What ideas bridge domains?
- What notes are isolated?
- What concepts are duplicated?
- What needs to become doctrine?
- What am I circling but not deciding?
