# Post-Release Routine

## After v1 tag is created

Once WilliamOS v1 is tagged, the system shifts from "building" to "operating."

### Immediate (same day)

1. Verify tag exists: `git tag -l`
2. Verify tag points to correct commit: `git log v1.0.0 -1`
3. Create a fresh backup: `python scripts/william.py backup --dest <safe-location>`
4. Verify the backup: `python scripts/william.py backup-verify <archive.zip>`
5. Run a restore drill against the post-tag backup

### Daily cadence

1. `python scripts/william.py today` — create daily command note
2. `python scripts/william.py inbox "thought"` — capture thoughts as they come
3. `python scripts/william.py check` — verify vault health

### Weekly cadence

1. `python scripts/william.py weekly` — create weekly review note
2. `python scripts/william.py synth-week` — generate weekly synthesis
3. `python scripts/william.py process-inbox` — triage inbox notes
4. `python scripts/william.py cockpit` — generate review cockpit
5. `python scripts/william.py snapshot --message "Weekly snapshot YYYY-Www"` — commit changes

### Monthly cadence

1. `python scripts/william.py cortex-map` — regenerate cortex map
2. `python scripts/william.py promote-doctrine` — check for doctrine candidates
3. `python scripts/william.py promote-decisions` — check for decision candidates
4. `python scripts/william.py backup --dest <safe-location>` — off-machine backup
5. `python scripts/william.py restore-drill --latest` — verify backup integrity

### Quarterly cadence

1. `python scripts/william.py acceptance` — full system acceptance review
2. `python scripts/william.py release-manifest` — update release manifest
3. Review remote strategy if off-machine protection is desired
4. Consider tagging a new minor version if significant changes accumulated

## Operating principles

- The system works for you, not the other way around
- Skip cadence items if the week is light — the system adapts
- Never let governance overhead exceed the value of the notes themselves
- If a command feels pointless, that is feedback — adjust the routine
- The cockpit shows what needs attention — trust it

## What NOT to do after release

- Do not push the tag unless you have explicitly set up a remote
- Do not assume the system needs more features before it is useful
- Do not skip the daily note — it is the foundation of everything else
- Do not let the inbox grow past 20 unprocessed notes
- Do not ignore cockpit red/yellow lanes for more than two weeks
