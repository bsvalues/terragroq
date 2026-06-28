# Release Tag Policy

## What a tag means

A Git tag in WilliamOS marks a validated, accepted milestone. It means:

- All required acceptance checks passed at the time of tagging
- The working tree was clean (all changes committed)
- No forbidden files were present
- No remotes were configured (unless explicitly approved)
- Source notes were verified intact

## What a tag does NOT mean

- The tag is NOT pushed to any remote
- The tag does NOT publish anything
- The tag does NOT trigger CI/CD
- The tag does NOT share notes
- The tag does NOT create a GitHub release

Tags are local-only governance markers.

## Tagging rules

1. Tags are annotated (`git tag -a`) with a message describing the release
2. Tags may only be created if the latest acceptance review passed
3. Tags may only be created on a clean working tree
4. Tags may only be created when no forbidden files are present
5. Tags may only be created when no unexpected remotes exist
6. Tags follow semantic versioning: `v1.0.0`, `v1.1.0`, `v2.0.0`
7. A dry-run must be available to preview before creating

## Tagging commands

```bash
# Preview
python scripts/william.py release-tag --name v1.0.0 --dry-run

# Create (only if acceptance passed and tree is clean)
python scripts/william.py release-tag --name v1.0.0
```

## No-push rule

Tags are never pushed automatically. If you later add a remote and want to push tags, that is a separate manual decision:

```bash
# Only after explicit remote setup and approval
git push origin v1.0.0
```

The release engine will never execute this command.

## Rollback confidence

If something goes wrong after tagging:

1. The tag marks the exact commit that was validated
2. `git checkout v1.0.0` restores that exact state
3. Backup archives from before the tag provide a second recovery path
4. Restore drill has proven that backups are actually restorable

## Version scheme

| Version | Meaning |
|---|---|
| v1.0.0 | First validated release — all WO-001 through WO-016 complete |
| v1.x.0 | Minor improvements, new WOs, cadence hardening |
| v2.0.0 | Major structural changes (if ever needed) |
