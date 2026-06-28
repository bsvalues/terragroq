# First 7 Days with WilliamOS

A simple start. One step per day. No rush.

## Day 1 — Open and capture

1. Open `WilliamOS/` as a vault in Obsidian.
2. Run `python scripts/william.py init` to confirm the scaffold.
3. Run `python scripts/william.py today` to create your first daily command note.
4. Capture 5 quick thoughts:

```bash
python scripts/william.py inbox "Public trust is the real product"
python scripts/william.py inbox "Need to clarify comp adjustment policy"
python scripts/william.py inbox "What does the office lose time on repeatedly?"
python scripts/william.py inbox "TerraFusion moat = workflow trust, not features"
python scripts/william.py inbox "Review how I explain values to skeptical taxpayers"
```

5. Fill in your daily command note in Obsidian.

## Day 2 — Write doctrine

Create 3 doctrine notes for beliefs you already hold:

```bash
python scripts/william.py doctrine "Public Trust Is the Product"
python scripts/william.py doctrine "Evidence Before Opinion"
python scripts/william.py doctrine "Finish Before Expanding"
```

Open each in Obsidian and fill in the Rule, Meaning, and Applies To sections. Keep it short.

## Day 3 — Write concepts

Create 3 concept notes for ideas you keep returning to:

```bash
python scripts/william.py concept "Assessor as Translator"
python scripts/william.py concept "Academy as Moat"
python scripts/william.py concept "Taxpayer Trust Gradient"
```

Fill in What It Means and Why It Matters. Link to doctrine where relevant.

## Day 4 — Make a decision

Create your first decision record:

```bash
python scripts/william.py decision "Separate Personal Brain from TerraFusion"
```

Open it and fill in the Decision, Why, Alternatives Considered, and Risks sections. Set the review date.

## Day 5 — Write a case

Create your first case or appraisal note:

```bash
python scripts/william.py case "Comparable Selection for Mixed-Use" --case-type appraisal
```

Fill in Facts, Issue, Evidence, Analysis, and the reusable principle.

## Day 6 — Check hygiene

Run the governance checks:

```bash
python scripts/william.py orphans
python scripts/william.py stale-decisions
python scripts/william.py check
```

Review the output. Fix any missing frontmatter or unlinked notes.

## Day 7 — Weekly review

Create and fill in your first weekly review:

```bash
python scripts/william.py weekly
```

Answer each question honestly. Identify one thing to promote to doctrine, one decision to make, and one thing to stop thinking about.

Optional: run your first graph review:

```bash
python scripts/william.py graph
```

Commit your work:

```bash
git add .
git commit -m "Week 1 WilliamOS review"
```

## What's next

- Continue the daily note habit.
- Process inbox items into concepts, doctrine, or decisions.
- Build out the Assessor, Appraisal, and TerraFusion Strategy areas.
- Run monthly Graphify reviews.
- Use the dashboards in `50_Dashboards/` for navigation.
