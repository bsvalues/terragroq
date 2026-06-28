---
type: policy
status: active
area: commands
created: 2026-06-16
tags:
  - commands
  - policy
---

# Command Registry Policy

## Rules

1. **Every CLI command must be registered.** The COMMAND_GROUPS dict in `williamos_commands.py` is the source of truth.
2. **Every command has a safety classification.** `safe: True` means it can run without risk. `safe: False` means it modifies official folders or deletes data.
3. **Every command has a writes classification.** `writes: True` means it creates or modifies files. `writes: False` means read-only.
4. **Registry count must match CLI argparse count.** The `command-report` command checks this.
5. **No commands push, create remotes, or upload.** This is enforced by the safety classification.
6. **New commands must be added to the registry when added to william.py.**
