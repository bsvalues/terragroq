#!/usr/bin/env node
import {
  runCanonicalFailureRecoveryCertification,
  verifyCanonicalFailureRecoveryCertification,
} from "./failure-recovery-certification.mjs"

verifyCanonicalFailureRecoveryCertification()
process.stdout.write(`${JSON.stringify(runCanonicalFailureRecoveryCertification(), null, 2)}\n`)
