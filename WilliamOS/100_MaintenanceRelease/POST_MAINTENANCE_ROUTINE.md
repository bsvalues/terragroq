---
type: governance
status: accepted
tags:
  - maintenance
  - routine
  - governance
---

# Post-Maintenance Routine

## After Tagging v1.1.0

Once the maintenance tag is created, follow this cadence:

### Immediate (Same Day)

1. Verify the tag exists: `git tag -l`
2. Verify the tag points to the right commit: `git log --oneline -1 v1.1.0`
3. Run `maintenance-status` to confirm the manifest reflects the tag
4. Optionally run `backup --dry-run` to see what a backup would include

### Daily

Continue the normal operating routine:
- `daily-review` for daily command notes
- `review-queues` to check pending items
- `cockpit` for lane health

### Weekly

- `weekly-review` for weekly operating review
- `acceptance-checklist` to check for items ready for acceptance
- `snapshot` if meaningful changes accumulated

### Monthly

- `monthly-review` for monthly cortex review
- `cortex-map` for graph refresh
- Consider if another maintenance release is warranted

## When to Create the Next Maintenance Release

Create a new maintenance release (v1.2.0, etc.) when:
- A new batch of work orders is complete
- Significant governance changes have been made
- A new subsystem has been added and validated

Do not create maintenance releases for trivial changes. The daily snapshot flow handles routine work.

## No-Push Reminder

Even after a maintenance tag, do not push unless you have explicitly configured a remote and intend to share. The tag is a local milestone, not a publication event.
