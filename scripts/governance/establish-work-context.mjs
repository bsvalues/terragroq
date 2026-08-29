#!/usr/bin/env node

process.stderr.write([
  "LEGACY_WORK_CONTEXT_RECEIPT_RETIRED",
  "Work context lives on the active WilliamOS Space and its persisted assignment.",
  "This command cannot create a Work Order, grant, reservation, or receipt for a lane or pull request.",
  "At delivery, WilliamOS may sign the exact output of an existing Space-bound assignment.",
].join("\n") + "\n")
process.exit(2)
