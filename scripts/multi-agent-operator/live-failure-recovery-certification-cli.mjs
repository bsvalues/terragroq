#!/usr/bin/env node
import {
  runCanonicalLiveFailureRecoveryCertification,
  verifyCanonicalLiveFailureRecoveryCertification,
} from "./live-failure-recovery-certification.mjs"

verifyCanonicalLiveFailureRecoveryCertification()
process.stdout.write(`${JSON.stringify(runCanonicalLiveFailureRecoveryCertification(), null, 2)}\n`)
