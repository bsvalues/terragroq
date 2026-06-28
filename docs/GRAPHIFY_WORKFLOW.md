# Graphify Workflow

## Purpose

Graphify should answer:

- What ideas are central?
- What ideas bridge appraisal, assessor leadership, and TerraFusion strategy?
- What notes are isolated?
- What concepts are duplicated?
- What should become doctrine?
- What am I circling but not deciding?

## First runs

Run on selected folders first:

```bash
python scripts/william.py graph --target WilliamOS/03_Doctrine
python scripts/william.py graph --target WilliamOS/04_Appraisal
python scripts/william.py graph --target WilliamOS/05_Assessor_Office
python scripts/william.py graph --target WilliamOS/06_TerraFusion_Strategy
```

## Full run

```bash
python scripts/william.py graph
```

## Monthly graph review template

Create this in `20_Graphify/`:

```markdown
---
type: graph-review
status: active
created: YYYY-MM-DD
---

# Graph Review - YYYY-MM

## Top central nodes

## Surprise connections

## Orphan notes

## Emerging doctrines

## Duplicated concepts

## Notes to merge

## Notes to split

## Strategic insight

## One decision to make
```
