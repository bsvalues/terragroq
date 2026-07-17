#!/usr/bin/env node

import {
  canonicalIndependentSecretIdentityTrustAuditJson,
  IndependentSecretIdentityTrustAuditError,
  runCanonicalIndependentSecretIdentityTrustAudit,
} from "./independent-secret-identity-trust-audit.mjs"

function failure(code, field, detail = undefined) {
  return {
    schemaVersion: 1,
    artifactType: "INDEPENDENT_SECRET_IDENTITY_TRUST_AUDIT_CLI_RESULT",
    ok: false,
    code,
    field,
    detail,
    runtimeActivated: false,
    secretReadAttempted: false,
    secretValueObserved: false,
    identityMutated: false,
    githubApiCalled: false,
    authorityGranted: false,
  }
}

let result
if (process.argv.length !== 2) {
  result = failure("SECRET_TRUST_AUDIT_CLI_ARGUMENT_WALL", "arguments")
} else {
  try {
    result = { ok: true, ...runCanonicalIndependentSecretIdentityTrustAudit() }
  } catch (error) {
    result = error instanceof IndependentSecretIdentityTrustAuditError
      ? failure(error.code, error.field, error.detail)
      : failure("SECRET_TRUST_AUDIT_CLI_EXECUTION_WALL", "execution")
  }
}

process.stdout.write(`${canonicalIndependentSecretIdentityTrustAuditJson(result)}\n`)
process.exitCode = result.ok === false ? 2 : 0
