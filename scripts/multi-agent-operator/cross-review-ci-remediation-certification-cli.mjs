#!/usr/bin/env node
import {
  runCanonicalCrossReviewCiRemediationCertification,
  verifyCanonicalCrossReviewCiRemediationCertification,
} from "./cross-review-ci-remediation-certification.mjs"

verifyCanonicalCrossReviewCiRemediationCertification()
process.stdout.write(`${JSON.stringify(runCanonicalCrossReviewCiRemediationCertification(), null, 2)}\n`)
