import { canonicalSha256, validateDeterministicValidatorCircuit } from "./deterministic-validator-recovery.mjs"
import {
  ACQUISITION_AUTHORITY_PREDICATE,
  EXACT_EXECUTION_ORIGIN_PREDICATE,
  LIVE_APPROVAL_PREDICATE,
  exactProjectedWorkContractPredicate,
} from "./outcome-queue-source.mjs"

const RECOVERY_LEASE_DURATION_MS = 50 * 60 * 1000

function wall(code, detail) {
  throw Object.assign(new Error(detail ?? code), { code })
}

export async function withDeterministicValidatorRecoveryTransaction({
  client, userId, operation,
} = {}) {
  if (!client || typeof client.query !== "function" || typeof operation !== "function"
    || typeof userId !== "string" || userId.trim() === "") {
    wall("HERMES_DETERMINISTIC_QUEUE_RECOVERY_TRANSACTION_WALL")
  }
  try {
    await client.query("BEGIN")
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`${userId}:outcome-queue`])
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`${userId}:deterministic-validator-recovery`])
    const result = await operation(client)
    await client.query("COMMIT")
    return result
  } catch (error) {
    try { await client.query("ROLLBACK") } catch {}
    throw error
  }
}

/**
 * Atomically supersede the authoritative queue contract for one locally fenced
 * deterministic wall. The durable receipt is the crash-replay boundary: a
 * retry after DB commit returns the same queue fence and contract identity.
 */
export async function recoverDeterministicValidatorQueue({ execution, pool: suppliedPool } = {}) {
  const circuit = validateDeterministicValidatorCircuit(
    execution?.metadata?.deterministicValidatorCircuit,
  )
  const outcome = execution?.metadata?.outcome
  const queue = outcome?.queueBinding
  const recovery = circuit?.recovery
  if (!circuit || circuit.status !== "DETERMINISTIC_CONTRACT_RECOVERY"
    || !outcome || !queue || !recovery
    || execution.lease?.status !== "ABANDONED"
    || execution.fencingToken !== circuit.sourceFencingToken) {
    wall("HERMES_DETERMINISTIC_QUEUE_RECOVERY_INPUT_WALL")
  }
  let ownedPool = null
  const pool = suppliedPool ?? await (async () => {
    const { Pool } = await import("pg")
    ownedPool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 })
    return ownedPool
  })()
  const client = await pool.connect()
  try {
    return await withDeterministicValidatorRecoveryTransaction({
      client, userId: outcome.userId, operation: async () => {
    const idempotencyKey = `${outcome.outcomeKey}:deterministic-validator-recovery:${recovery.fingerprint}`
    const prior = await client.query(
      `SELECT id, "requestHash", "requestBinding", "resultBinding"
         FROM "outcome_queue_mutation_receipt"
        WHERE "userId" = $1 AND "idempotencyKey" = $2 FOR UPDATE`,
      [outcome.userId, idempotencyKey],
    )
    if (prior.rows.length > 1) wall("HERMES_DETERMINISTIC_QUEUE_RECOVERY_RECEIPT_WALL")
    let initialReplay = null
    if (prior.rows.length === 1) {
      const receipt = prior.rows[0]
      const result = receipt.resultBinding
      if (receipt.requestHash !== canonicalSha256(receipt.requestBinding)
        || result?.recoveryId !== recovery.recoveryId
        || result?.fingerprint !== recovery.fingerprint
        || result?.replacementContract?.id !== recovery.replacementContract.id
        || result?.replacementContract?.digest !== recovery.replacementContract.digest) {
        wall("HERMES_DETERMINISTIC_QUEUE_RECOVERY_RECEIPT_WALL")
      }
      initialReplay = { receipt, result }
    }
    const continuations = initialReplay ? await client.query(
      `SELECT id, "requestHash", "requestBinding", "resultBinding"
         FROM "outcome_queue_mutation_receipt"
        WHERE "userId" = $1 AND "outcomeKey" = $2
          AND operation = 'deterministic_validator.continue'
          AND "requestBinding"->>'recoveryId' = $3
          AND "requestBinding"->>'fingerprint' = $4
        ORDER BY id ASC FOR UPDATE`,
      [outcome.userId, outcome.outcomeKey, recovery.recoveryId, recovery.fingerprint],
    ) : { rows: [] }
    let replay = initialReplay
    for (const continuation of continuations.rows) {
      const request = continuation.requestBinding
      const result = continuation.resultBinding
      const previous = replay?.result?.queueRecovery
      if (!replay || continuation.requestHash !== canonicalSha256(request)
        || request?.operation !== "deterministic_validator.continue"
        || request?.recoveryId !== recovery.recoveryId
        || request?.fingerprint !== recovery.fingerprint
        || Number(request?.parentRecoveryReceiptId) !== Number(initialReplay.receipt.id)
        || Number(request?.previousReceiptId) !== Number(replay.receipt.id)
        || Number(request?.sourceExpectedVersion) !== previous.recoveredExpectedVersion
        || Number(request?.sourceFencingToken) !== previous.recoveredFencingToken
        || request?.sourceLeaseExpiresAt !== previous.recoveredLeaseExpiresAt
        || result?.recoveryId !== recovery.recoveryId
        || result?.fingerprint !== recovery.fingerprint
        || result?.replacementContract?.id !== recovery.replacementContract.id
        || result?.replacementContract?.digest !== recovery.replacementContract.digest
        || result?.queueRecovery?.sourceExpectedVersion !== previous.sourceExpectedVersion
        || result?.queueRecovery?.sourceFencingToken !== previous.sourceFencingToken
        || result?.queueRecovery?.recoveredExpectedVersion !== previous.recoveredExpectedVersion + 1
        || result?.queueRecovery?.recoveredFencingToken !== previous.recoveredFencingToken + 1
        || result?.queueRecovery?.continuationCount !== (previous.continuationCount ?? 0) + 1) {
        wall("HERMES_DETERMINISTIC_QUEUE_RECOVERY_RECEIPT_WALL")
      }
      replay = { receipt: continuation, result }
    }

    const oldValidators = recovery.oldContract.validationCommands.map(
      ({ command, args }) => `${command} ${args.join(" ")}`,
    )
    const newValidators = recovery.replacementContract.validationCommands.map(
      ({ command, args }) => `${command} ${args.join(" ")}`,
    )
    const clock = await client.query('SELECT clock_timestamp() AS "now"')
    const recordedAt = new Date(clock.rows[0].now).toISOString()
    const recoveredLeaseExpiresAt = new Date(
      Date.parse(recordedAt) + RECOVERY_LEASE_DURATION_MS,
    ).toISOString()
    const expectedValidators = replay ? newValidators : oldValidators
    const current = await client.query(
      `SELECT q.id, q."goalId", q."goalRef", q."outcomeKey", q.version, q."executionBinding",
        q."leaseHolder", q."leaseToken", q."leaseExpiresAt", q."acquisitionKey", q."fencingToken",
        q."authorityGrantRef", q."activeWorkOrderId", q."lifecycleState"
       FROM "outcome_queue_mutation_receipt" AS work_contract_receipt
       JOIN "outcome_queue_item" AS q
         ON work_contract_receipt."userId" = q."userId"
       JOIN "work_order" AS projected_work
         ON projected_work."userId" = q."userId"
        AND projected_work.id = q."activeWorkOrderId"
       WHERE q."userId" = $1 AND q."outcomeKey" = $2
         AND (${LIVE_APPROVAL_PREDICATE})
         AND (${ACQUISITION_AUTHORITY_PREDICATE
    .replaceAll("$8", "$4")
    .replaceAll("$1::timestamptz", "$3::timestamptz")})
         AND (${EXACT_EXECUTION_ORIGIN_PREDICATE.replaceAll("$1::timestamptz", "$3::timestamptz")})
         AND (${exactProjectedWorkContractPredicate({
    expectedLeaseHolder: "$5",
    expectedValidators: "$6::text[]",
  })})
         AND projected_work.ref = CASE WHEN work_contract_receipt.operation = 'runtime_finding.derive'
           THEN work_contract_receipt."resultBinding"->>'workOrderRef'
           ELSE 'WO-HERMES-OUTCOME-' || q."goalId"::text END
         AND projected_work.goal = q."goalRef"
         AND projected_work.status = 'active'
         AND NOT EXISTS (
           SELECT 1 FROM "outcome_queue_item" AS live
           WHERE live."userId" = q."userId" AND live.id <> q.id
             AND live."lifecycleState" = 'active'
             AND live."leaseExpiresAt" > $3::timestamptz
         )
       FOR UPDATE OF q, projected_work, work_contract_receipt`,
      [outcome.userId, outcome.outcomeKey, recordedAt,
        Number(queue.activeWorkOrderId), queue.leaseHolder, expectedValidators],
    )
    if (current.rows.length !== 1) wall("HERMES_DETERMINISTIC_QUEUE_RECOVERY_CAS_WALL")
    const row = current.rows[0]
    const expectedVersion = replay?.result?.queueRecovery?.recoveredExpectedVersion ?? queue.expectedVersion
    const expectedFence = replay?.result?.queueRecovery?.recoveredFencingToken ?? queue.fencingToken
    const parsedGoalId = Number(outcome.goalId ?? String(outcome.ref ?? "").match(/^GOAL-(\d+)$/)?.[1])
    if (Number(row.version) !== expectedVersion
      || Number(row.fencingToken) !== expectedFence
      || row.outcomeKey !== outcome.outcomeKey
      || (Number.isSafeInteger(parsedGoalId) && Number(row.goalId) !== parsedGoalId)
      || (typeof outcome.ref === "string" && row.goalRef !== outcome.ref)
      || row.executionBinding !== queue.executionBinding
      || row.leaseHolder !== queue.leaseHolder
      || row.leaseToken !== queue.leaseToken
      || row.acquisitionKey !== queue.acquisitionKey
      || Number(row.activeWorkOrderId) !== Number(queue.activeWorkOrderId)
      || row.authorityGrantRef !== queue.authorityGrantRef
      || row.lifecycleState !== "active"
      || (replay && new Date(row.leaseExpiresAt).toISOString()
        !== replay.result.queueRecovery.recoveredLeaseExpiresAt)) {
      wall("HERMES_DETERMINISTIC_QUEUE_RECOVERY_CAS_WALL")
    }
    const authorization = await client.query(
      `SELECT id, operation, "requestHash", "requestBinding", "resultBinding"
       FROM "outcome_queue_mutation_receipt"
       WHERE "userId" = $1 AND "outcomeKey" = $2
         AND operation IN ('workbench_execution.authorize', 'runtime_finding.derive')
       ORDER BY id LIMIT 2 FOR UPDATE`,
      [outcome.userId, outcome.outcomeKey],
    )
    if (authorization.rows.length !== 1
      || authorization.rows[0].resultBinding?.workContract?.id !== recovery.oldContract.id
      || authorization.rows[0].resultBinding?.workContract?.digest !== recovery.oldContract.digest) {
      wall("HERMES_DETERMINISTIC_QUEUE_RECOVERY_PARENT_WALL")
    }
    const acquisition = await client.query(
      `SELECT id, "latestFencingToken" FROM "outcome_queue_acquisition_receipt"
       WHERE "userId" = $1 AND "acquisitionKey" = $2 AND "outcomeKey" = $3 FOR UPDATE`,
      [outcome.userId, queue.acquisitionKey, outcome.outcomeKey],
    )
    if (acquisition.rows.length !== 1
      || Number(acquisition.rows[0].latestFencingToken) !== expectedFence) {
      wall("HERMES_DETERMINISTIC_QUEUE_RECOVERY_ACQUISITION_WALL")
    }
    if (replay && Date.parse(replay.result.queueRecovery.recoveredLeaseExpiresAt) > Date.parse(recordedAt)) {
      return {
        ...replay.result.queueRecovery,
        receiptId: Number(replay.receipt.id),
        replacementContract: replay.result.replacementContract,
      }
    }

    if (replay) {
      const previous = replay.result.queueRecovery
      const recoveredExpectedVersion = Number(row.version) + 1
      const recoveredFencingToken = Number(row.fencingToken) + 1
      const queueRecovery = {
        version: "hermes-deterministic-validator-queue-recovery.v1",
        recoveryId: recovery.recoveryId,
        fingerprint: recovery.fingerprint,
        sourceExpectedVersion: previous.sourceExpectedVersion,
        sourceFencingToken: previous.sourceFencingToken,
        recoveredExpectedVersion,
        recoveredFencingToken,
        recoveredLeaseExpiresAt,
        recordedAt,
        continuationCount: (previous.continuationCount ?? 0) + 1,
      }
      const requestBinding = {
        operation: "deterministic_validator.continue",
        outcomeId: String(execution.outcomeId),
        outcomeKey: outcome.outcomeKey,
        recoveryId: recovery.recoveryId,
        fingerprint: recovery.fingerprint,
        parentRecoveryReceiptId: Number(initialReplay.receipt.id),
        previousReceiptId: Number(replay.receipt.id),
        sourceExpectedVersion: Number(row.version),
        sourceFencingToken: Number(row.fencingToken),
        sourceLeaseExpiresAt: new Date(row.leaseExpiresAt).toISOString(),
      }
      const resultBinding = {
        recoveryId: recovery.recoveryId,
        fingerprint: recovery.fingerprint,
        supersedes: recovery.supersedes,
        queueRecovery,
        replacementContract: recovery.replacementContract,
      }
      const continuationKey = `${idempotencyKey}:continue:${row.version}:${row.fencingToken}`
      const receipt = await client.query(
        `INSERT INTO "outcome_queue_mutation_receipt"
          ("userId", "idempotencyKey", operation, "outcomeKey", "requestHash",
            "requestBinding", "resultBinding", "createdAt")
         VALUES ($1,$2,'deterministic_validator.continue',$3,$4,$5::jsonb,$6::jsonb,$7::timestamptz)
         RETURNING id`,
        [outcome.userId, continuationKey, outcome.outcomeKey, canonicalSha256(requestBinding),
          JSON.stringify(requestBinding), JSON.stringify(resultBinding), recordedAt],
      )
      const updated = await client.query(
        `UPDATE "outcome_queue_item" SET version = $3, "fencingToken" = $4,
            "leaseExpiresAt" = $8::timestamptz,
            "lifecycleReason" = 'DETERMINISTIC_VALIDATOR_RECOVERY_LEASE_CONTINUED',
            "updatedAt" = $7::timestamptz
         WHERE "userId" = $1 AND "outcomeKey" = $2 AND version = $5 AND "fencingToken" = $6
           AND "executionBinding" = $9 AND "leaseHolder" = $10 AND "leaseToken" = $11
           AND "acquisitionKey" = $12 AND "activeWorkOrderId" = $13
           AND "leaseExpiresAt" = $14::timestamptz
         RETURNING id`,
        [outcome.userId, outcome.outcomeKey, recoveredExpectedVersion, recoveredFencingToken,
          Number(row.version), Number(row.fencingToken), recordedAt, recoveredLeaseExpiresAt,
          queue.executionBinding, queue.leaseHolder, queue.leaseToken, queue.acquisitionKey,
          Number(queue.activeWorkOrderId), new Date(row.leaseExpiresAt).toISOString()],
      )
      if (updated.rows.length !== 1) wall("HERMES_DETERMINISTIC_QUEUE_RECOVERY_CAS_WALL")
      const acquired = await client.query(
        `UPDATE "outcome_queue_acquisition_receipt" SET "latestFencingToken" = $4,
            "updatedAt" = $5::timestamptz
         WHERE "userId" = $1 AND "acquisitionKey" = $2 AND "outcomeKey" = $3
           AND "latestFencingToken" = $6 RETURNING id`,
        [outcome.userId, queue.acquisitionKey, outcome.outcomeKey,
          recoveredFencingToken, recordedAt, Number(row.fencingToken)],
      )
      if (acquired.rows.length !== 1) wall("HERMES_DETERMINISTIC_QUEUE_RECOVERY_ACQUISITION_WALL")
      await client.query(
        `INSERT INTO "governance_event"
          ("userId", "eventType", "entityType", "entityId", actor, reason, metadata, "createdAt")
         VALUES ($1,'DETERMINISTIC_VALIDATOR_RECOVERY_LEASE_CONTINUED','outcome_queue_item',$2,
          'Hermes','Expired deterministic recovery lease continued',$3::jsonb,$4::timestamptz)`,
        [outcome.userId, outcome.outcomeKey, JSON.stringify({
          recoveryId: recovery.recoveryId,
          fingerprint: recovery.fingerprint,
          previousReceiptId: Number(replay.receipt.id),
          receiptId: Number(receipt.rows[0].id),
          sourceExpectedVersion: Number(row.version),
          recoveredExpectedVersion,
          sourceFencingToken: Number(row.fencingToken),
          recoveredFencingToken,
        }), recordedAt],
      )
      return {
        ...queueRecovery,
        receiptId: Number(receipt.rows[0].id),
        replacementContract: recovery.replacementContract,
      }
    }

    const recoveredExpectedVersion = Number(row.version) + 1
    const recoveredFencingToken = Number(row.fencingToken) + 1
    const queueRecovery = {
      version: "hermes-deterministic-validator-queue-recovery.v1",
      recoveryId: recovery.recoveryId,
      fingerprint: recovery.fingerprint,
      sourceExpectedVersion: Number(row.version),
      sourceFencingToken: Number(row.fencingToken),
      recoveredExpectedVersion,
      recoveredFencingToken,
      recoveredLeaseExpiresAt,
      recordedAt,
      continuationCount: 0,
    }
    const requestBinding = {
      operation: "deterministic_validator.recover",
      outcomeId: String(execution.outcomeId),
      outcomeKey: outcome.outcomeKey,
      recoveryId: recovery.recoveryId,
      fingerprint: recovery.fingerprint,
      parentReceiptId: Number(authorization.rows[0].id),
      priorContractId: recovery.oldContract.id,
      priorContractDigest: recovery.oldContract.digest,
      worktreeSnapshotHash: recovery.structuredInputs.worktreeSnapshotHash,
      validatorVersion: recovery.structuredInputs.validatorVersion,
      wallCode: recovery.structuredInputs.wallCode,
      missingTestPaths: recovery.structuredInputs.missingTestPaths,
    }
    const resultBinding = {
      recoveryId: recovery.recoveryId,
      fingerprint: recovery.fingerprint,
      supersedes: recovery.supersedes,
      queueRecovery,
      replacementContract: recovery.replacementContract,
    }
    const receipt = await client.query(
      `INSERT INTO "outcome_queue_mutation_receipt"
        ("userId", "idempotencyKey", operation, "outcomeKey", "requestHash",
          "requestBinding", "resultBinding", "createdAt")
       VALUES ($1,$2,'deterministic_validator.recover',$3,$4,$5::jsonb,$6::jsonb,$7::timestamptz)
       RETURNING id`,
      [outcome.userId, idempotencyKey, outcome.outcomeKey, canonicalSha256(requestBinding),
        JSON.stringify(requestBinding), JSON.stringify(resultBinding), recordedAt],
    )
    const updated = await client.query(
      `UPDATE "outcome_queue_item" SET version = $3, "fencingToken" = $4,
          "leaseExpiresAt" = $8::timestamptz,
          "lifecycleReason" = 'DETERMINISTIC_VALIDATOR_CONTRACT_RECOVERED', "updatedAt" = $7::timestamptz
       WHERE "userId" = $1 AND "outcomeKey" = $2 AND version = $5 AND "fencingToken" = $6
         AND "executionBinding" = $9 AND "leaseHolder" = $10 AND "leaseToken" = $11
         AND "acquisitionKey" = $12 AND "activeWorkOrderId" = $13
       RETURNING id`,
      [outcome.userId, outcome.outcomeKey, recoveredExpectedVersion, recoveredFencingToken,
        queueRecovery.sourceExpectedVersion, queueRecovery.sourceFencingToken, recordedAt,
        recoveredLeaseExpiresAt, queue.executionBinding, queue.leaseHolder, queue.leaseToken,
        queue.acquisitionKey, Number(queue.activeWorkOrderId)],
    )
    if (updated.rows.length !== 1) wall("HERMES_DETERMINISTIC_QUEUE_RECOVERY_CAS_WALL")
    const acquired = await client.query(
      `UPDATE "outcome_queue_acquisition_receipt" SET "latestFencingToken" = $4, "updatedAt" = $5::timestamptz
       WHERE "userId" = $1 AND "acquisitionKey" = $2 AND "outcomeKey" = $3
         AND "latestFencingToken" = $6 RETURNING id`,
      [outcome.userId, queue.acquisitionKey, outcome.outcomeKey,
        recoveredFencingToken, recordedAt, queueRecovery.sourceFencingToken],
    )
    if (acquired.rows.length !== 1) wall("HERMES_DETERMINISTIC_QUEUE_RECOVERY_ACQUISITION_WALL")
    const rebound = await client.query(
      `UPDATE "work_order" SET validators = $3::text[], "updatedAt" = $4::timestamptz
       WHERE "userId" = $1 AND id = $2 AND validators = $5::text[] RETURNING id`,
      [outcome.userId, Number(queue.activeWorkOrderId), newValidators, recordedAt, oldValidators],
    )
    if (rebound.rows.length !== 1) wall("HERMES_DETERMINISTIC_QUEUE_RECOVERY_WORK_ORDER_WALL")
    await client.query(
      `INSERT INTO "governance_event"
        ("userId", "eventType", "entityType", "entityId", actor, reason, metadata, "createdAt")
       VALUES ($1,'DETERMINISTIC_VALIDATOR_CONTRACT_SUPERSEDED','outcome_queue_item',$2,
        'Hermes','Deterministic validator contract recovery',$3::jsonb,$4::timestamptz)`,
      [outcome.userId, outcome.outcomeKey, JSON.stringify({
        recoveryId: recovery.recoveryId,
        fingerprint: recovery.fingerprint,
        priorContractId: recovery.oldContract.id,
        priorContractDigest: recovery.oldContract.digest,
        replacementContractId: recovery.replacementContract.id,
        replacementContractDigest: recovery.replacementContract.digest,
        sourceFencingToken: queueRecovery.sourceFencingToken,
        recoveredFencingToken,
        receiptId: Number(receipt.rows[0].id),
      }), recordedAt],
    )
    return {
      ...queueRecovery,
      receiptId: Number(receipt.rows[0].id),
      replacementContract: recovery.replacementContract,
    }
      },
    })
  } finally {
    client.release()
    if (ownedPool) await ownedPool.end()
  }
}
