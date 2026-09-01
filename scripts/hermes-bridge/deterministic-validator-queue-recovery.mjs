import { canonicalJson, canonicalSha256, validateDeterministicValidatorCircuit } from "./deterministic-validator-recovery.mjs"
import { EXACT_EXECUTION_ORIGIN_PREDICATE } from "./outcome-queue-source.mjs"

function wall(code, detail) {
  throw Object.assign(new Error(detail ?? code), { code })
}

function exactArray(left, right) {
  return canonicalJson(left) === canonicalJson(right)
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
    await client.query("BEGIN")
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`${outcome.userId}:outcome-queue`])
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`${outcome.userId}:deterministic-validator-recovery`])
    const idempotencyKey = `${outcome.outcomeKey}:deterministic-validator-recovery:${recovery.fingerprint}`
    const prior = await client.query(
      `SELECT id, "requestHash", "requestBinding", "resultBinding"
         FROM "outcome_queue_mutation_receipt"
        WHERE "userId" = $1 AND "idempotencyKey" = $2 FOR UPDATE`,
      [outcome.userId, idempotencyKey],
    )
    if (prior.rows.length > 1) wall("HERMES_DETERMINISTIC_QUEUE_RECOVERY_RECEIPT_WALL")
    let replay = null
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
      replay = { receipt, result }
    }

    const clock = await client.query('SELECT clock_timestamp() AS "now"')
    const recordedAt = new Date(clock.rows[0].now).toISOString()
    const current = await client.query(
      `SELECT q.id, q."goalId", q."goalRef", q."outcomeKey", q.version, q."executionBinding",
        "leaseHolder", "leaseToken", "acquisitionKey", "fencingToken",
        "authorityGrantRef", "activeWorkOrderId", "lifecycleState"
       FROM "outcome_queue_item" AS q
       WHERE q."userId" = $1 AND q."outcomeKey" = $2
         AND (${EXACT_EXECUTION_ORIGIN_PREDICATE.replaceAll("$1::timestamptz", "$3::timestamptz")})
       FOR UPDATE OF q`,
      [outcome.userId, outcome.outcomeKey, recordedAt],
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
      || row.lifecycleState !== "active") {
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
    const oldValidators = recovery.oldContract.validationCommands.map(
      ({ command, args }) => `${command} ${args.join(" ")}`,
    )
    const newValidators = recovery.replacementContract.validationCommands.map(
      ({ command, args }) => `${command} ${args.join(" ")}`,
    )
    const work = await client.query(
      `SELECT id, ref, goal, "allowedFiles", validators FROM "work_order"
       WHERE "userId" = $1 AND id = $2 FOR UPDATE`,
      [outcome.userId, Number(queue.activeWorkOrderId)],
    )
    if (work.rows.length !== 1
      || work.rows[0].goal !== row.goalRef
      || !exactArray(work.rows[0].allowedFiles, recovery.oldContract.reservations)
      || !exactArray(work.rows[0].validators, replay ? newValidators : oldValidators)) {
      wall("HERMES_DETERMINISTIC_QUEUE_RECOVERY_WORK_ORDER_WALL")
    }

    if (replay) {
      await client.query("COMMIT")
      return {
        ...replay.result.queueRecovery,
        receiptId: Number(replay.receipt.id),
        replacementContract: replay.result.replacementContract,
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
      recordedAt,
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
          "lifecycleReason" = 'DETERMINISTIC_VALIDATOR_CONTRACT_RECOVERED', "updatedAt" = $7::timestamptz
       WHERE "userId" = $1 AND "outcomeKey" = $2 AND version = $5 AND "fencingToken" = $6
       RETURNING id`,
      [outcome.userId, outcome.outcomeKey, recoveredExpectedVersion, recoveredFencingToken,
        queueRecovery.sourceExpectedVersion, queueRecovery.sourceFencingToken, recordedAt],
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
    await client.query("COMMIT")
    return {
      ...queueRecovery,
      receiptId: Number(receipt.rows[0].id),
      replacementContract: recovery.replacementContract,
    }
  } catch (error) {
    try { await client.query("ROLLBACK") } catch {}
    throw error
  } finally {
    client.release()
    if (ownedPool) await ownedPool.end()
  }
}
