import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"

const SHA = /^[0-9a-f]{40,64}$/

function notifyProgress(observer, entry) {
  try { Promise.resolve(observer?.({ ...entry })).catch(() => {}) } catch { /* observers have no transaction authority */ }
}

/**
 * Shared CREATE transaction for legacy and manifest-bound proposals. Adapters
 * supply schema/path policy only; the core owns phase order, candidate
 * construction, publication order, and cleanup.
 */
export async function runGovernedCreateTransaction(transaction) {
  const {
    errorPrefix,
    repository,
    runtime,
    proposalId,
    branch,
    workspace,
    files,
    engine,
    boundPaths,
    expectedHead,
    progressContract,
    onProgress,
    git,
    gitIndexEnvironment,
    ensureWorkspaceParent,
    assertWorkspace,
    executeTurn,
    validateTurn,
    validateWorkspace,
    validationResult,
    snapshot,
    assertSnapshot,
    changedPaths,
    verifyCandidate,
    patchPaths,
    removeWorktree,
    createReceipt,
    validateReceipt,
    review,
    prepareStorage,
    writePatch,
    publishPatch,
    writeReceipt,
    cleanupCreationArtifacts,
    persistCreationQuarantine,
    deleteBranch,
    commitMessage,
    secretScan,
    assertRepositoryBoundary,
    assertReferenceBoundary,
  } = transaction
  const code = typeof errorPrefix === "string" ? errorPrefix : "APPLICATION_PROPOSAL"
  const createdAt = new Date().toISOString()
  const progress = []
  const observe = (index, notify = true) => {
    const contract = progressContract[index]
    const entry = { stage: contract[0], detail: contract[1], at: new Date().toISOString() }
    progress.push(entry)
    if (notify) notifyProgress(onProgress, entry)
    return entry
  }
  observe(0)
  await assertRepositoryBoundary?.()
  await ensureWorkspaceParent()
  const baseRef = transaction.readBaseRef ? await transaction.readBaseRef() : null
  if (baseRef) await assertReferenceBoundary?.(baseRef)
  await assertReferenceBoundary?.(`refs/heads/${branch}`)
  const baseSha = (await git(repository, ["rev-parse", "HEAD"])).stdout.trim()
  if (!SHA.test(baseSha)) throw new Error(transaction.baseInvalidCode ?? `${code}_BASE_INVALID`)
  if (expectedHead && baseSha !== expectedHead) throw new Error(`${code}_STALE_BASE`)
  if (baseRef && transaction.readBaseRef && await transaction.readBaseRef() !== baseRef) throw new Error(`${code}_STALE_BASE`)
  if ((await git(repository, ["status", "--porcelain=v1", "-z", "--", ...boundPaths])).stdout) {
    throw new Error(`${code}_CANONICAL_DIRTY`)
  }
  let persisted = false
  let workspaceRemoved = false
  let worktreeAttempted = false
  let artifactWriteStarted = false
  let publicationValue
  let publicationBytes
  let candidateSha = null
  const ownedBranchTargets = new Set()
  const temporaryIndex = `${workspace}.candidate-index-${crypto.randomUUID()}`
  try {
    worktreeAttempted = true
    await git(repository, ["worktree", "add", "-b", branch, workspace, baseSha])
    const createdBranch = await git(repository, ["show-ref", "--hash", "--verify", `refs/heads/${branch}`], { allowFailure: true })
    if (createdBranch.code !== 0 || createdBranch.stdout.trim() !== baseSha) {
      throw new Error(`${code}_ARTIFACT_CLEANUP_FAILED`)
    }
    ownedBranchTargets.add(baseSha)
    await assertRepositoryBoundary?.()
    assertWorkspace(workspace)
    observe(1)
    observe(2)
    const turn = await executeTurn({ workspace, baseSha })
    observe(3)
    validateTurn?.(turn)
    const residentHead = (await git(workspace, ["rev-parse", "HEAD"])).stdout.trim()
    ownedBranchTargets.add(residentHead)
    if (residentHead !== baseSha) {
      throw new Error(`${code}_RESIDENT_HEAD_MUTATED`)
    }
    const paths = changedPaths((await git(workspace, ["status", "--porcelain=v1", "-z", "--untracked-files=all"])).stdout)
    engine.assertChangedPaths(paths, turn?.ignoredPathsCreated ?? null)
    assertWorkspace(workspace)
    const proposed = snapshot(workspace, boundPaths)
    secretScan?.({ turn, proposed, paths })
    await git(workspace, ["diff", "--check", "--", ...paths], { errorCode: `${code}_DIFF_INVALID` })
    observe(4)
    const validation = validationResult(await validateWorkspace(workspace))
    assertWorkspace(workspace)
    assertSnapshot(workspace, proposed, `${code}_VALIDATION_HASH_MISMATCH`)
    const validatedHead = (await git(workspace, ["rev-parse", "HEAD"])).stdout.trim()
    ownedBranchTargets.add(validatedHead)
    if (validatedHead !== baseSha) {
      throw new Error(`${code}_RESIDENT_HEAD_MUTATED`)
    }

    await assertRepositoryBoundary?.()
    const indexEnvironment = gitIndexEnvironment(temporaryIndex)
    await git(workspace, ["read-tree", baseSha], { env: indexEnvironment })
    const expectedCandidateEntries = new Map()
    for (const relative of paths) {
      const state = proposed.get(relative)
      if (!state || !Buffer.isBuffer(state.bytes)) throw new Error(`${code}_WORKSPACE_FILE_INVALID`)
      const blob = (await git(repository, ["hash-object", "-w", "--stdin"], {
        env: indexEnvironment,
        input: state.bytes,
      })).stdout.trim()
      if (!SHA.test(blob)) throw new Error(`${code}_COMMIT_INVALID`)
      const mode = state.mode & 0o111 ? "100755" : "100644"
      expectedCandidateEntries.set(relative, { mode, blob })
      await git(workspace, ["update-index", "--add", "--cacheinfo", `${mode},${blob},${relative}`], { env: indexEnvironment })
    }
    const tree = (await git(workspace, ["write-tree"], { env: indexEnvironment })).stdout.trim()
    candidateSha = (await git(repository, [
      "-c", "commit.gpgSign=false",
      "-c", "user.name=WilliamOS HERMES Proposal",
      "-c", "user.email=hermes@williamos.local",
      "commit-tree", tree, "-p", baseSha, "-m", commitMessage,
    ], { env: indexEnvironment })).stdout.trim()
    ownedBranchTargets.add(candidateSha)
    const candidateEntries = await verifyCandidate(workspace, baseSha, candidateSha, paths)
    for (const relative of paths) {
      if (JSON.stringify(candidateEntries.get(relative)) !== JSON.stringify(expectedCandidateEntries.get(relative))) {
        throw new Error(`${code}_COMMIT_INVALID`)
      }
    }
    assertSnapshot(workspace, proposed, `${code}_VALIDATION_HASH_MISMATCH`)
    await assertRepositoryBoundary?.()
    await assertReferenceBoundary?.(`refs/heads/${branch}`)
    await git(repository, ["update-ref", `refs/heads/${branch}`, candidateSha, baseSha])
    const bytes = Buffer.from((await git(workspace, [
      "diff", "--no-ext-diff", "--no-textconv", "--binary", "--full-index", baseSha, candidateSha, "--", ...paths,
    ], { encoding: "buffer" })).stdout)
    if (!bytes.length || bytes.length > transaction.maxPatchBytes || bytes.includes(0)) {
      throw new Error(`${code}_PATCH_SIZE_REFUSED`)
    }
    secretScan?.({ patchBytes: bytes })
    await removeWorktree(repository, runtime, workspace)
    workspaceRemoved = true
    const ready = observe(5, false)
    const value = createReceipt({
      proposalId,
      progress,
      createdAt,
      baseRef,
      baseSha,
      candidateSha,
      branch,
      changedPaths: paths,
      patchBytes: bytes,
      validation,
      turn,
    })
    validateReceipt(value, proposalId)
    await prepareStorage(files)
    publicationValue = value
    publicationBytes = bytes
    artifactWriteStarted = true
    const stagedPatch = await writePatch(files, bytes)
    const verified = await patchPaths(repository, bytes, engine.allowedPaths, stagedPatch)
    if (JSON.stringify(verified) !== JSON.stringify(paths)) throw new Error(`${code}_PATCH_SCOPE_MISMATCH`)
    review(value, { ...files, patch: stagedPatch })
    await publishPatch(files, stagedPatch, bytes)
    review(value, files)
    await writeReceipt(files, value)
    persisted = true
    notifyProgress(onProgress, ready)
    return review(value, files)
  } catch (error) {
    if (artifactWriteStarted && !persisted) {
      const cleaned = await cleanupCreationArtifacts({ files, value: publicationValue, bytes: publicationBytes })
      if (!cleaned) {
        if (publicationValue && publicationBytes) {
          await persistCreationQuarantine({ value: publicationValue, bytes: publicationBytes, files })
        }
        throw new Error(`${code}_ARTIFACT_CLEANUP_FAILED`)
      }
    }
    throw error
  } finally {
    try { fs.rmSync(temporaryIndex, { force: true }) } catch { /* bounded temporary */ }
    let cleanupFailure = false
    if (!workspaceRemoved && worktreeAttempted) {
      try { await removeWorktree(repository, runtime, workspace) }
      catch { cleanupFailure = true }
    }
    if (!persisted) {
      try { await deleteBranch(repository, branch, ownedBranchTargets) }
      catch { cleanupFailure = true }
    }
    if (cleanupFailure) {
      throw new Error(transaction.worktreeCleanupErrorCode ?? `${code}_ARTIFACT_CLEANUP_FAILED`)
    }
  }
}

const sameFile = (left, right) => !!left && !!right && left.mode === right.mode && left.bytes.equals(right.bytes)
const sameIdentity = (stat, identity) => !!identity
  && String(stat.dev) === identity.dev && String(stat.ino) === identity.ino

function readDescriptorExact(descriptor, length, errorCode) {
  const bytes = Buffer.alloc(length)
  let offset = 0
  while (offset < bytes.length) {
    const count = fs.readSync(descriptor, bytes, offset, bytes.length - offset, offset)
    if (count <= 0) throw new Error(errorCode)
    offset += count
  }
  const probe = Buffer.alloc(1)
  if (fs.readSync(descriptor, probe, 0, 1, bytes.length) !== 0) throw new Error(errorCode)
  return bytes
}

/** Write only through an already-opened, singly-linked regular file whose
 * identity and bytes still match the captured transaction snapshot. */
function writeOwnedFile(target, expected, next, errorCode) {
  let descriptor
  try {
    const before = fs.lstatSync(target, { bigint: true })
    if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1n || !sameIdentity(before, expected.identity)) {
      throw new Error(errorCode)
    }
    const noFollow = process.platform === "win32" ? 0 : (fs.constants.O_NOFOLLOW ?? 0)
    descriptor = fs.openSync(target, fs.constants.O_RDWR | noFollow)
    const opened = fs.fstatSync(descriptor, { bigint: true })
    const observed = fs.lstatSync(target, { bigint: true })
    if (!opened.isFile() || opened.nlink !== 1n || observed.nlink !== 1n
      || !sameIdentity(opened, expected.identity) || !sameIdentity(observed, expected.identity)
      || Number(opened.mode & 0o777n) !== expected.mode
      || !readDescriptorExact(descriptor, expected.bytes.length, errorCode).equals(expected.bytes)) {
      throw new Error(errorCode)
    }
    // Proposal candidates are forbidden from changing modes; avoiding chmod
    // keeps the descriptor write portable on Windows while preserving mode.
    if (next.mode !== expected.mode) throw new Error(errorCode)
    fs.ftruncateSync(descriptor, 0)
    let offset = 0
    while (offset < next.bytes.length) {
      const count = fs.writeSync(descriptor, next.bytes, offset, next.bytes.length - offset, offset)
      if (count <= 0) throw new Error(errorCode)
      offset += count
    }
    fs.fsyncSync(descriptor)
    const after = fs.fstatSync(descriptor, { bigint: true })
    const pathAfter = fs.lstatSync(target, { bigint: true })
    if (after.nlink !== 1n || pathAfter.nlink !== 1n || !sameIdentity(after, expected.identity)
      || !sameIdentity(pathAfter, expected.identity) || Number(after.mode & 0o777n) !== next.mode
      || !readDescriptorExact(descriptor, next.bytes.length, errorCode).equals(next.bytes)) {
      throw new Error(errorCode)
    }
  } catch (error) {
    if (error?.message === errorCode) throw error
    throw new Error(errorCode)
  } finally { if (descriptor !== undefined) try { fs.closeSync(descriptor) } catch { /* transaction verification follows */ } }
}
const entryPath = (entry) => entry.slice(entry.indexOf("\t") + 1)
const entryFor = (entries, relative) => entries.find((entry) => entryPath(entry) === relative)
const formatEntry = (relative, entry) => `${entry.mode} ${entry.blob} 0\t${relative}`

export async function deleteOwnedProposalBranch({ git, repository, branch, ownedTargets, errorCode, assertReferenceBoundary }) {
  const reference = `refs/heads/${branch}`
  await assertReferenceBoundary?.(reference)
  const probe = await git(repository, ["show-ref", "--verify", "--quiet", reference], { allowFailure: true })
  if (probe.code !== 0) {
    if (probe.code === 1 && probe.executionFailure !== true && !String(probe.stderr ?? "").trim()) return false
    throw new Error(errorCode)
  }
  const current = await git(repository, ["show-ref", "--hash", "--verify", reference], { allowFailure: true })
  if (current.code !== 0) throw new Error(errorCode)
  const observed = current.stdout.trim()
  if (!(ownedTargets instanceof Set) || !ownedTargets.has(observed)) throw new Error(errorCode)
  await assertReferenceBoundary?.(reference)
  const removed = await git(repository, ["update-ref", "-d", reference, observed], { allowFailure: true })
  const verified = await git(repository, ["show-ref", "--verify", "--quiet", reference], { allowFailure: true })
  if (removed.code !== 0 || verified.code !== 1 || verified.executionFailure === true
    || String(verified.stderr ?? "").trim()) {
    throw new Error(errorCode)
  }
  return true
}

/**
 * Shared APPLY transaction. Receipt codecs own schema transforms; this core
 * owns the reviewed-patch validation, canonical file/index/ref CAS, exact
 * terminal publication point, and ownership-proved rollback/quarantine.
 */
export async function runGovernedApplyTransaction(transaction) {
  const {
    errorPrefix,
    repository,
    runtime,
    proposalId,
    value,
    patchBytes,
    changedPaths,
    allowedPaths,
    boundPaths,
    baseSha,
    candidateSha,
    configuredBaseRef,
    workspace,
    git,
    readBaseRef,
    patchPaths,
    snapshot,
    assertSnapshot,
    regularFile,
    indexEntries,
    setIndexEntry,
    treeEntries,
    verifyCandidate,
    assertWorkspace,
    validateWorkspace,
    validationResult,
    removeWorktree,
    createAppliedReceipt,
    validateReceipt,
    publishAppliedReceipt,
    restoreReadyReceipt,
    quarantine,
    assertClaimOwnership,
    releaseClaim,
    deleteBranch,
    transactionOperations = {},
    assertRepositoryBoundary,
    assertReferenceBoundary,
  } = transaction
  const code = typeof errorPrefix === "string" ? errorPrefix : "APPLICATION_PROPOSAL"
  const checkpoint = async (stage, state = {}) => transactionOperations.checkpoint?.(stage, {
    baseSha,
    candidateSha,
    ref: state.ref,
    phase: state.phase,
  })
  await assertRepositoryBoundary?.()
  assertClaimOwnership()
  if (!Buffer.isBuffer(patchBytes) || !patchBytes.length || patchBytes.length > transaction.maxPatchBytes
    || patchBytes.includes(0) || transaction.digest(patchBytes) !== transaction.patchDigest) {
    throw new Error(`${code}_PATCH_MISMATCH`)
  }
  transaction.secretScan?.(patchBytes)
  const reviewedPaths = await patchPaths(repository, patchBytes, allowedPaths)
  if (JSON.stringify(reviewedPaths) !== JSON.stringify(changedPaths)) {
    throw new Error(`${code}_PATCH_SCOPE_MISMATCH`)
  }
  const ref = configuredBaseRef ?? await readBaseRef()
  await assertReferenceBoundary?.(ref)
  const assertHead = async (expected, failure = `${code}_STALE_BASE`) => {
    if (await readBaseRef() !== ref || (await git(repository, ["rev-parse", ref])).stdout.trim() !== expected) {
      throw new Error(failure)
    }
  }
  await assertHead(baseSha)
  if ((await git(repository, ["status", "--porcelain=v1", "-z", "--", ...boundPaths])).stdout) {
    throw new Error(`${code}_TARGET_DIRTY`)
  }
  const original = snapshot(repository, boundPaths)
  const originalIndex = await indexEntries(repository)
  const baseEntries = await treeEntries(repository, baseSha, changedPaths)
  const candidateEntries = await verifyCandidate(repository, baseSha, candidateSha, changedPaths)
  let workspaceRemoved = false
  let proposed
  let canonicalExpected
  let phase = "VALIDATING"
  const written = new Set()
  const indexed = new Set()
  try {
    await git(repository, ["worktree", "add", "--detach", workspace, baseSha])
    await assertRepositoryBoundary?.()
    assertWorkspace(workspace)
    const workspaceOriginal = snapshot(workspace, boundPaths)
    for (const [relative, state] of original) {
      const target = regularFile(workspace, relative)
      writeOwnedFile(target, workspaceOriginal.get(relative), state, `${code}_WORKSPACE_FILE_INVALID`)
    }
    await git(workspace, ["apply", "--whitespace=error-all", "-"], {
      errorCode: `${code}_PATCH_INVALID`,
      input: patchBytes,
    })
    proposed = snapshot(workspace, boundPaths)
    canonicalExpected = new Map(original)
    for (const relative of changedPaths) canonicalExpected.set(relative, {
      ...proposed.get(relative),
      identity: original.get(relative).identity,
    })
    for (const relative of changedPaths) {
      const state = proposed.get(relative)
      const blob = (await git(repository, ["hash-object", "--stdin"], { input: state.bytes })).stdout.trim()
      const mode = state.mode & 0o111 ? "100755" : "100644"
      if (candidateEntries.get(relative)?.blob !== blob || candidateEntries.get(relative)?.mode !== mode) {
        throw new Error(`${code}_COMMIT_INVALID`)
      }
    }
    const validation = validationResult(await validateWorkspace(workspace))
    assertWorkspace(workspace)
    assertSnapshot(workspace, proposed, `${code}_VALIDATION_HASH_MISMATCH`)
    assertSnapshot(repository, original, transaction.canonicalValidationDriftCode ?? `${code}_TARGET_DIRTY`)
    await checkpoint("validated", { phase, ref })
    await checkpoint("receipt_prewrite", { phase, ref })
    phase = "WRITING"
    await assertRepositoryBoundary?.()
    for (const relative of changedPaths) {
      await checkpoint("canonical_write", { phase, ref })
      assertSnapshot(repository, new Map([[relative, original.get(relative)]]), `${code}_TARGET_DIRTY`)
      const target = regularFile(repository, relative)
      written.add(relative)
      writeOwnedFile(target, original.get(relative), canonicalExpected.get(relative), `${code}_TARGET_DIRTY`)
    }
    await checkpoint("before_publish", { phase, ref })
    await assertHead(baseSha, `${code}_TARGET_DIRTY`)
    if (JSON.stringify(await indexEntries(repository)) !== JSON.stringify(originalIndex)) {
      throw new Error(`${code}_TARGET_DIRTY`)
    }
    assertSnapshot(repository, canonicalExpected, `${code}_VALIDATION_HASH_MISMATCH`)
    await assertRepositoryBoundary?.()
    await assertReferenceBoundary?.(ref)
    await git(repository, ["update-ref", ref, candidateSha, baseSha])
    phase = "PUBLISHED"
    await checkpoint("published", { phase, ref })
    for (const relative of changedPaths) {
      const current = entryFor(await indexEntries(repository), relative)
      if (current !== entryFor(originalIndex, relative)) throw new Error(`${code}_TARGET_DIRTY`)
      await setIndexEntry(repository, relative, candidateEntries.get(relative))
      indexed.add(relative)
    }
    phase = "INDEX_SYNCED"
    await checkpoint("index_synced", { phase, ref })
    await assertHead(candidateSha, `${code}_TARGET_DIRTY`)
    assertSnapshot(repository, canonicalExpected, `${code}_VALIDATION_HASH_MISMATCH`)
    const finalIndex = await indexEntries(repository)
    for (const relative of changedPaths) {
      if (entryFor(finalIndex, relative) !== formatEntry(relative, candidateEntries.get(relative))) {
        throw new Error(`${code}_TARGET_DIRTY`)
      }
    }
    if ((await git(repository, ["status", "--porcelain=v1", "-z", "--", ...boundPaths])).stdout) {
      throw new Error(`${code}_TARGET_DIRTY`)
    }
    await removeWorktree(repository, runtime, workspace)
    workspaceRemoved = true
    const applied = createAppliedReceipt({ value, candidateSha, validation })
    validateReceipt(applied, proposalId)
    await checkpoint("receipt_replace", { phase, ref })
    assertClaimOwnership()
    await publishAppliedReceipt(applied)
    phase = "FINALIZED"
    try { await releaseClaim({ terminal: true }) } catch { /* durable APPLIED is authoritative */ }
    await deleteBranch?.()
    return transaction.review(applied)
  } catch (error) {
    if (phase === "FINALIZED") throw error
    let recovered = true
    try {
      if (phase === "VALIDATING" && written.size === 0 && indexed.size === 0) {
        assertClaimOwnership()
        await restoreReadyReceipt()
        await releaseClaim({ terminal: false })
        throw Object.assign(error, { proposalPreMutationRecovered: true })
      }
      if (["PUBLISHED", "INDEX_SYNCED"].includes(phase)) {
        await checkpoint("rollback_ref", { phase, ref })
        await assertRepositoryBoundary?.()
        await assertReferenceBoundary?.(ref)
        await assertHead(candidateSha, `${code}_ROLLBACK_FAILED`)
        await git(repository, ["update-ref", ref, baseSha, candidateSha])
      }
      if (proposed) {
        const currentEntry = async (relative) => {
          const entries = (await indexEntries(repository)).filter((entry) => entryPath(entry) === relative)
          if (entries.length !== 1) throw new Error("unowned index")
          return entries[0]
        }
        for (const relative of written) {
          await assertHead(baseSha, `${code}_ROLLBACK_FAILED`)
          const baseEntry = entryFor(originalIndex, relative)
          const candidateEntry = formatEntry(relative, candidateEntries.get(relative))
          const ownedIndex = await currentEntry(relative)
          if (ownedIndex !== baseEntry && (!indexed.has(relative) || ownedIndex !== candidateEntry)) throw new Error("unowned index")
          const actual = snapshot(repository, [relative]).get(relative)
          if (!sameFile(actual, original.get(relative))) {
            if (!sameFile(actual, proposed.get(relative))) throw new Error("unowned file")
            await checkpoint("restore_file", { phase, ref })
            if (await currentEntry(relative) !== ownedIndex) throw new Error("unowned index")
            const ownedProposed = { ...proposed.get(relative), identity: original.get(relative).identity }
            assertSnapshot(repository, new Map([[relative, ownedProposed]]), `${code}_ROLLBACK_FAILED`)
            const target = regularFile(repository, relative)
            writeOwnedFile(target, ownedProposed, original.get(relative), `${code}_ROLLBACK_FAILED`)
            if (await currentEntry(relative) !== ownedIndex) throw new Error("unowned index")
            assertSnapshot(repository, new Map([[relative, original.get(relative)]]), `${code}_ROLLBACK_FAILED`)
          }
        }
        for (const relative of indexed) {
          const current = await currentEntry(relative)
          const baseEntry = entryFor(originalIndex, relative)
          const candidateEntry = formatEntry(relative, candidateEntries.get(relative))
          if (current !== baseEntry) {
            if (current !== candidateEntry) throw new Error("unowned index")
            await checkpoint("restore_index", { phase, ref })
            assertSnapshot(repository, new Map([[relative, original.get(relative)]]), `${code}_ROLLBACK_FAILED`)
            await setIndexEntry(repository, relative, baseEntries.get(relative))
            if (await currentEntry(relative) !== baseEntry) throw new Error("unowned index")
          }
        }
      }
      await assertHead(baseSha, `${code}_ROLLBACK_FAILED`)
      assertSnapshot(repository, original, `${code}_ROLLBACK_FAILED`)
      const restoredIndex = await indexEntries(repository)
      for (const relative of changedPaths) {
        if (entryFor(restoredIndex, relative) !== entryFor(originalIndex, relative)) throw new Error("index restore")
      }
      if ((await git(repository, ["status", "--porcelain=v1", "-z", "--", ...boundPaths])).stdout) {
        throw new Error("restore dirty")
      }
      assertClaimOwnership()
      await restoreReadyReceipt()
      await releaseClaim({ terminal: false })
    } catch (recoveryError) {
      if (recoveryError?.proposalPreMutationRecovered) throw error
      recovered = false
    }
    if (!recovered) {
      await quarantine(`${code}_ROLLBACK_FAILED`)
      throw new Error(`${code}_ROLLBACK_FAILED`)
    }
    throw error
  } finally {
    if (!workspaceRemoved) {
      try { await removeWorktree(repository, runtime, workspace) }
      catch {
        if (phase !== "FINALIZED") {
          if (transaction.worktreeCleanupFailureCode) {
            throw new Error(transaction.worktreeCleanupFailureCode)
          }
          try { await quarantine(`${code}_WORKTREE_CLEANUP_FAILED`) } catch { /* rollback error below is authoritative */ }
          throw new Error(`${code}_ROLLBACK_FAILED`)
        }
      }
    }
  }
}

/**
 * Repository-scoped Apply coordinator shared by every receipt codec. The
 * adapters can project legacy/v4 journals, but only the core orders terminal
 * inspection, lock acquisition/recovery, claim publication, Apply, and lock
 * release.
 */
export async function runGovernedApplyLifecycle(transaction) {
  const {
    load,
    assertOwner,
    assertBinding,
    assertTerminalBinding = assertBinding,
    status,
    inspect,
    onTerminal,
    canClaim,
    acquireRepositoryLock,
    releaseRepositoryLock,
    recoverStale,
    claimApply,
    applyClaimed,
    reconcileLocked,
  } = transaction
  const initiallyLoaded = load()
  let stored = initiallyLoaded && typeof initiallyLoaded.then === "function" ? await initiallyLoaded : initiallyLoaded
  assertOwner(stored)
  if (status(stored) === "APPLIED") {
    assertTerminalBinding(stored)
    return onTerminal(stored)
  }
  assertBinding(stored)
  if (!canClaim(status(stored))) throw new Error(`${transaction.errorPrefix}_NOT_APPLICABLE`)
  inspect(stored)
  const preLockStored = stored
  let proposalClaim = null
  if (transaction.claimBeforeRepositoryLock) {
    if (status(stored) !== "READY_FOR_REVIEW") throw new Error(`${transaction.errorPrefix}_NOT_APPLICABLE`)
    proposalClaim = await claimApply(stored, null)
  }
  let repositoryClaim
  try { repositoryClaim = await acquireRepositoryLock(recoverStale) }
  catch (error) {
    if (proposalClaim) await transaction.rollbackUnappliedClaim(proposalClaim)
    throw error
  }
  let completed = false
  try {
    if (proposalClaim) {
      proposalClaim = transaction.bindClaimToRepository
        ? await transaction.bindClaimToRepository(proposalClaim, repositoryClaim)
        : proposalClaim
      const result = await applyClaimed(preLockStored, proposalClaim, repositoryClaim)
      completed = true
      return result
    }
    stored = await load()
    assertOwner(stored)
    if (status(stored) === "APPLIED") {
      assertTerminalBinding(stored)
      completed = true
      return onTerminal(stored)
    }
    assertBinding(stored)
    if (status(stored) !== "READY_FOR_REVIEW") {
      return await reconcileLocked(stored, repositoryClaim)
    }
    inspect(stored)
    proposalClaim = await claimApply(stored, repositoryClaim)
    const result = await applyClaimed(stored, proposalClaim, repositoryClaim)
    completed = true
    return result
  } finally {
    try { await releaseRepositoryLock(repositoryClaim) }
    catch (error) { if (!completed) throw error }
  }
}

function rejectedTerminal(transaction, claim) {
  const updated = transaction.createRejectedReceipt(claim)
  transaction.validateReceipt(updated, transaction.proposalId)
  return updated
}

/** Legacy-compatible synchronous rejection coordinator. Durable claim and
 * codec details are hooks, while terminal construction/publication/release
 * ordering remains shared with the generic rejection lifecycle below. */
export function runGovernedRejectLifecycleSync(transaction) {
  const claim = transaction.claimReject()
  if (claim.terminal) return claim.terminal
  const updated = rejectedTerminal(transaction, claim)
  let finalized = false
  try {
    const result = transaction.publishRejected(claim, updated)
    finalized = true
    transaction.releaseClaim(claim, { terminal: true })
    return result
  } catch (error) {
    if (!finalized) {
      const completed = transaction.matchingTerminal?.(claim, updated)
      if (completed) return completed
      try { transaction.releaseClaim(claim, { terminal: false }) }
      catch {
        const completedAfterReleaseRace = transaction.matchingTerminal?.(claim, updated)
        if (completedAfterReleaseRace) return completedAfterReleaseRace
        throw new Error(`${transaction.errorPrefix}_ROLLBACK_FAILED`)
      }
    }
    throw error
  } finally { transaction.cleanupTemporary?.() }
}

/** Repository-scoped generic rejection coordinator. REJECTED is the
 * irreversible intent record; candidate cleanup is an idempotent post-terminal
 * CAS so a process death can always resume the requested rejection. */
export async function runGovernedRejectLifecycle(transaction) {
  let stored = await transaction.load()
  transaction.assertOwner(stored)
  transaction.assertBinding(stored)
  if (transaction.status(stored) === "REJECTED") return transaction.onTerminal(stored)
  if (transaction.status(stored) !== "READY_FOR_REVIEW") {
    throw new Error(`${transaction.errorPrefix}_NOT_APPLICABLE`)
  }
  transaction.inspect(stored)
  const repositoryClaim = await transaction.acquireRepositoryLock(transaction.recoverStale)
  let completed = false
  try {
    stored = await transaction.load()
    transaction.assertOwner(stored)
    transaction.assertBinding(stored)
    if (transaction.status(stored) === "REJECTED") {
      completed = true
      return transaction.onTerminal(stored)
    }
    if (transaction.status(stored) !== "READY_FOR_REVIEW") {
      throw new Error(`${transaction.errorPrefix}_NOT_APPLICABLE`)
    }
    transaction.inspect(stored)
    const claim = await transaction.claimReject(stored, repositoryClaim)
    const updated = rejectedTerminal(transaction, claim)
    await transaction.checkpoint?.("before_terminal_publication", { claim, updated })
    await transaction.publishRejected(claim, updated)
    completed = true
    await transaction.checkpoint?.("terminal_published", { claim, updated })
    await transaction.cleanupCandidate(claim)
    await transaction.checkpoint?.("candidate_cleaned", { claim, updated })
    return transaction.review(updated, claim)
  } finally {
    try { await transaction.releaseRepositoryLock(repositoryClaim) }
    catch (error) { if (!completed) throw error }
  }
}

export const GOVERNED_PROPOSAL_TRANSACTION_CORE_VERSION = 1
