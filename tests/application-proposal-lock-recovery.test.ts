import { spawn, type ChildProcess } from "node:child_process"
import { createHash, randomUUID } from "node:crypto"
import { once } from "node:events"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

import { afterEach, describe, expect, it, vi } from "vitest"

import {
  acquireApplicationRepositoryLock,
  applicationProposalProcessIdentity,
  applicationRepositoryLockIdentity,
  applicationRepositoryLockPath,
  releaseApplicationRepositoryLock,
  withApplicationRepositoryRecoveryClaim,
} from "@/lib/applications/proposal-repository-lock.mjs"

vi.setConfig({ testTimeout: 20_000 })

const roots: string[] = []
const children: ChildProcess[] = []

afterEach(async () => {
  for (const child of children.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL")
      await once(child, "close").catch(() => undefined)
    }
  }
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

function fixture() {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "application-lock-recovery-"))
  roots.push(parent)
  const repositoryRoot = path.join(parent, "application")
  const runtimeRoot = path.join(parent, "runtime")
  fs.mkdirSync(repositoryRoot)
  return { repositoryRoot, runtimeRoot }
}

async function stalledRecoveryClaim(
  runtimeRoot: string,
  repositoryRoot: string,
  checkpoint: "recovery_claim_private_staged" | "recovery_claim_replace_staged",
) {
  const moduleUrl = pathToFileURL(path.join(process.cwd(), "lib/applications/proposal-repository-lock.mjs")).href
  const script = `
    import { withApplicationRepositoryRecoveryClaim } from ${JSON.stringify(moduleUrl)};
    const checkpoint = (stage) => {
      if (stage !== ${JSON.stringify(checkpoint)}) return;
      process.stdout.write(stage + "\\n");
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
    };
    await withApplicationRepositoryRecoveryClaim({
      runtimeRoot: ${JSON.stringify(runtimeRoot)},
      repositoryRoot: ${JSON.stringify(repositoryRoot)},
      transactionOperations: { checkpoint },
      action: async () => { throw new Error("checkpoint not reached"); },
    });
  `
  const child = spawn(process.execPath, ["--input-type=module", "-e", script], {
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  })
  children.push(child)
  let stderr = ""
  child.stderr?.on("data", (chunk) => { stderr += chunk.toString("utf8") })
  const closed = once(child, "close") as Promise<[number | null, NodeJS.Signals | null]>
  const [chunk] = await Promise.race([
    once(child.stdout!, "data") as Promise<[Buffer]>,
    closed.then(([code]) => { throw new Error(`lock residue helper exited ${code}: ${stderr}`) }),
  ])
  expect(chunk.toString("utf8").trim()).toBe(checkpoint)
  return { child, closed }
}

async function stalledRepositoryLockRelease(runtimeRoot: string, repositoryRoot: string) {
  const moduleUrl = pathToFileURL(path.join(process.cwd(), "lib/applications/proposal-repository-lock.mjs")).href
  const script = `
    import {
      acquireApplicationRepositoryLock,
      releaseApplicationRepositoryLock,
    } from ${JSON.stringify(moduleUrl)};
    const checkpoint = (stage) => {
      if (stage !== "repository_lock_release_staged") return;
      process.stdout.write(stage + "\\n");
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
    };
    const claim = await acquireApplicationRepositoryLock({
      runtimeRoot: ${JSON.stringify(runtimeRoot)},
      repositoryRoot: ${JSON.stringify(repositoryRoot)},
      proposalId: "11111111-1111-4111-8111-111111111111",
      recoverStale: async () => {},
      transactionOperations: { checkpoint },
    });
    releaseApplicationRepositoryLock(claim);
  `
  const child = spawn(process.execPath, ["--input-type=module", "-e", script], {
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  })
  children.push(child)
  let stderr = ""
  child.stderr?.on("data", (chunk) => { stderr += chunk.toString("utf8") })
  const closed = once(child, "close") as Promise<[number | null, NodeJS.Signals | null]>
  const [chunk] = await Promise.race([
    once(child.stdout!, "data") as Promise<[Buffer]>,
    closed.then(([code]) => { throw new Error(`lock release helper exited ${code}: ${stderr}`) }),
  ])
  expect(chunk.toString("utf8").trim()).toBe("repository_lock_release_staged")
  return { child, closed }
}

async function hardKill({ child, closed }: Awaited<ReturnType<typeof stalledRecoveryClaim>>) {
  if (!child.kill("SIGKILL")) throw new Error("lock residue helper could not be terminated")
  await closed
}

function lockDirectory(runtimeRoot: string) {
  return path.join(runtimeRoot, "application-proposal-locks")
}

function writePrivateResidue({
  runtimeRoot,
  repositoryRoot,
  value,
  publicName,
  bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`),
}: {
  runtimeRoot: string
  repositoryRoot: string
  value: Record<string, unknown>
  publicName: string
  bytes?: Buffer
}) {
  const directory = lockDirectory(runtimeRoot)
  fs.mkdirSync(directory, { recursive: true })
  const contentDigest = createHash("sha256").update(bytes).digest("hex")
  const target = path.join(directory, `${publicName}.${contentDigest}.write`)
  fs.writeFileSync(target, bytes)
  expect(publicName.startsWith(applicationRepositoryLockIdentity(repositoryRoot))).toBe(true)
  return target
}

describe("application proposal repository-lock crash residue", () => {
  it("retains a live pre-link residue, then reaps it after the writer is hard-killed", async () => {
    const target = fixture()
    const stalled = await stalledRecoveryClaim(
      target.runtimeRoot,
      target.repositoryRoot,
      "recovery_claim_private_staged",
    )
    const directory = lockDirectory(target.runtimeRoot)
    expect(fs.readdirSync(directory).filter((name) => name.endsWith(".write"))).toHaveLength(1)

    await expect(withApplicationRepositoryRecoveryClaim({
      ...target,
      waitMs: 25,
      action: async () => "must not run",
    })).rejects.toThrow("APPLICATION_PROPOSAL_LOCK_UNCERTAIN")
    expect(fs.readdirSync(directory).filter((name) => name.endsWith(".write"))).toHaveLength(1)

    await hardKill(stalled)
    await expect(withApplicationRepositoryRecoveryClaim({
      ...target,
      action: async () => "recovered",
    })).resolves.toBe("recovered")
    expect(fs.readdirSync(directory)).toEqual([])
  })

  it("reaps an atomic-replace staging residue after the writer is hard-killed", async () => {
    const target = fixture()
    const stalled = await stalledRecoveryClaim(
      target.runtimeRoot,
      target.repositoryRoot,
      "recovery_claim_replace_staged",
    )
    const directory = lockDirectory(target.runtimeRoot)
    expect(fs.readdirSync(directory).filter((name) => name.endsWith(".write"))).toHaveLength(1)

    await hardKill(stalled)
    await expect(withApplicationRepositoryRecoveryClaim({
      ...target,
      action: async () => "recovered",
    })).resolves.toBe("recovered")
    expect(fs.readdirSync(directory)).toEqual([])
  })

  it("reaps an exact same-process residue only after its publication token is inactive", async () => {
    const target = fixture()
    const repositoryDigest = applicationRepositoryLockIdentity(target.repositoryRoot)
    const token = randomUUID()
    writePrivateResidue({
      ...target,
      publicName: `${repositoryDigest}.reap-${token}.json`,
      value: {
        schemaVersion: 2,
        token,
        processId: process.pid,
        processIdentity: applicationProposalProcessIdentity(),
        startedAt: new Date().toISOString(),
        repositoryDigest,
        ticket: 0,
      },
    })

    await expect(withApplicationRepositoryRecoveryClaim({
      ...target,
      action: async () => "recovered",
    })).resolves.toBe("recovered")
    expect(fs.readdirSync(lockDirectory(target.runtimeRoot))).toEqual([])
  })

  it("accepts an exact residue name removed after the bounded directory scan", async () => {
    const target = fixture()
    const repositoryDigest = applicationRepositoryLockIdentity(target.repositoryRoot)
    const token = randomUUID()
    const residue = writePrivateResidue({
      ...target,
      publicName: `${repositoryDigest}.reap-${token}.json`,
      value: {
        schemaVersion: 2,
        token,
        processId: process.pid,
        processIdentity: applicationProposalProcessIdentity(),
        startedAt: new Date().toISOString(),
        repositoryDigest,
        ticket: 0,
      },
    })
    let raced = false

    await expect(withApplicationRepositoryRecoveryClaim({
      ...target,
      transactionOperations: {
        checkpoint(stage: string) {
          if (stage !== "private_lock_residue_discovered" || raced) return
          fs.unlinkSync(residue)
          raced = true
        },
      },
      action: async () => "recovered",
    })).resolves.toBe("recovered")
    expect(raced).toBe(true)
    expect(fs.readdirSync(lockDirectory(target.runtimeRoot))).toEqual([])
  })

  it("fails closed if the lock directory is swapped after residue path validation", async () => {
    const target = fixture()
    const repositoryDigest = applicationRepositoryLockIdentity(target.repositoryRoot)
    const token = randomUUID()
    const value = {
      schemaVersion: 2,
      token,
      processId: process.pid,
      processIdentity: applicationProposalProcessIdentity(),
      startedAt: new Date().toISOString(),
      repositoryDigest,
      ticket: 0,
    }
    const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`)
    const publicName = `${repositoryDigest}.reap-${token}.json`
    writePrivateResidue({ ...target, value, publicName, bytes })
    const directory = lockDirectory(target.runtimeRoot)
    fs.writeFileSync(path.join(directory, publicName), bytes)
    const heldDirectory = `${directory}-held`
    const externalDirectory = path.join(path.dirname(target.runtimeRoot), "external-lock-directory")
    fs.mkdirSync(externalDirectory)
    const externalClaim = path.join(externalDirectory, publicName)
    fs.writeFileSync(externalClaim, bytes)
    let swapped = false

    try {
      await expect(withApplicationRepositoryRecoveryClaim({
        ...target,
        transactionOperations: {
          checkpoint(stage: string) {
            if (stage !== "private_lock_residue_path_validated" || swapped) return
            fs.renameSync(directory, heldDirectory)
            fs.symlinkSync(externalDirectory, directory, process.platform === "win32" ? "junction" : "dir")
            swapped = true
          },
        },
        action: async () => "must not run",
      })).rejects.toThrow("APPLICATION_PROPOSAL_LOCK_UNCERTAIN")
      expect(swapped).toBe(true)
      expect(fs.readFileSync(externalClaim)).toEqual(bytes)
    } finally {
      try {
        if (fs.lstatSync(directory).isSymbolicLink()) fs.unlinkSync(directory)
      } catch { /* test cleanup continues through the shared root cleanup */ }
      if (fs.existsSync(heldDirectory) && !fs.existsSync(directory)) fs.renameSync(heldDirectory, directory)
    }
  })

  it("never unlinks an external stale lock if recovery swaps the lock directory", async () => {
    const target = fixture()
    const repositoryDigest = applicationRepositoryLockIdentity(target.repositoryRoot)
    const stale = {
      schemaVersion: 2,
      token: randomUUID(),
      processId: 2_147_483_647,
      processIdentity: "win:1234567890",
      startedAt: new Date().toISOString(),
      repositoryDigest,
      proposalId: randomUUID(),
    }
    const bytes = Buffer.from(`${JSON.stringify(stale, null, 2)}\n`)
    const lockTarget = applicationRepositoryLockPath(target.runtimeRoot, target.repositoryRoot)
    const directory = path.dirname(lockTarget)
    fs.mkdirSync(directory, { recursive: true })
    fs.writeFileSync(lockTarget, bytes)
    const heldDirectory = `${directory}-held`
    const externalDirectory = path.join(path.dirname(target.runtimeRoot), "external-stale-lock-directory")
    fs.mkdirSync(externalDirectory)
    const externalLock = path.join(externalDirectory, path.basename(lockTarget))
    fs.writeFileSync(externalLock, bytes)
    let swapped = false

    try {
      await expect(acquireApplicationRepositoryLock({
        ...target,
        proposalId: randomUUID(),
        recoverStale: async () => {
          fs.renameSync(directory, heldDirectory)
          fs.symlinkSync(externalDirectory, directory, process.platform === "win32" ? "junction" : "dir")
          swapped = true
        },
      })).rejects.toThrow("APPLICATION_PROPOSAL_LOCK_UNCERTAIN")
      expect(swapped).toBe(true)
      expect(fs.readFileSync(externalLock)).toEqual(bytes)
    } finally {
      try {
        if (fs.lstatSync(directory).isSymbolicLink()) fs.unlinkSync(directory)
      } catch { /* test cleanup continues through the shared root cleanup */ }
      if (fs.existsSync(heldDirectory) && !fs.existsSync(directory)) fs.renameSync(heldDirectory, directory)
    }
  })

  it("preserves a replacement if the exact repository-lock child changes at release", async () => {
    const target = fixture()
    const claim = await acquireApplicationRepositoryLock({
      ...target,
      proposalId: randomUUID(),
      recoverStale: async () => undefined,
    })
    const displaced = `${claim.target}.owned-displaced`
    const replacement = Buffer.from(claim.text)
    const originalRename = fs.renameSync.bind(fs)
    const originalUnlink = fs.unlinkSync.bind(fs)
    let swapped = false
    const swap = () => {
      if (swapped) return
      originalRename(claim.target, displaced)
      fs.writeFileSync(claim.target, replacement)
      swapped = true
    }
    const rename = vi.spyOn(fs, "renameSync").mockImplementation((source, destination) => {
      if (path.resolve(String(source)) === path.resolve(claim.target)) swap()
      return originalRename(source, destination)
    })
    const unlink = vi.spyOn(fs, "unlinkSync").mockImplementation((candidate) => {
      if (path.resolve(String(candidate)) === path.resolve(claim.target)) swap()
      return originalUnlink(candidate)
    })

    try {
      expect(() => releaseApplicationRepositoryLock(claim)).toThrow("APPLICATION_PROPOSAL_LOCK_UNCERTAIN")
      expect(swapped).toBe(true)
      expect(fs.readFileSync(claim.target)).toEqual(replacement)
      expect(fs.readFileSync(displaced, "utf8")).toBe(claim.text)
    } finally {
      rename.mockRestore()
      unlink.mockRestore()
    }
  })

  it("preserves a replacement raced onto the private release path before final unlink", async () => {
    const target = fixture()
    let claim: Awaited<ReturnType<typeof acquireApplicationRepositoryLock>>
    let releasePath = ""
    let displaced = ""
    const replacement = Buffer.from("unrelated release-path bytes\n")
    claim = await acquireApplicationRepositoryLock({
      ...target,
      proposalId: randomUUID(),
      recoverStale: async () => undefined,
      transactionOperations: {
        checkpoint(stage: string) {
          if (stage !== "repository_lock_release_staged") return
          const directory = lockDirectory(target.runtimeRoot)
          const name = fs.readdirSync(directory).find((entry) => entry.endsWith(".release"))!
          releasePath = path.join(directory, name)
          displaced = `${releasePath}.owned-displaced`
          fs.renameSync(releasePath, displaced)
          fs.writeFileSync(releasePath, replacement)
        },
      },
    })

    expect(() => releaseApplicationRepositoryLock(claim)).toThrow("APPLICATION_PROPOSAL_LOCK_UNCERTAIN")
    expect(releasePath).not.toBe("")
    expect(fs.readFileSync(releasePath)).toEqual(replacement)
    expect(fs.readFileSync(displaced, "utf8")).toBe(claim.text)
  })

  it("preserves structural release compatibility for a cloned claim", async () => {
    const target = fixture()
    const claim = await acquireApplicationRepositoryLock({
      ...target,
      proposalId: randomUUID(),
      recoverStale: async () => undefined,
    })

    expect(() => releaseApplicationRepositoryLock({
      ...claim,
      value: { ...claim.value },
    })).not.toThrow()
    expect(fs.existsSync(claim.target)).toBe(false)
  })

  it("does not widen cloned-claim compatibility to forged release content", async () => {
    const target = fixture()
    const claim = await acquireApplicationRepositoryLock({
      ...target,
      proposalId: randomUUID(),
      recoverStale: async () => undefined,
    })
    const forged = { ...claim, text: `${claim.text} ` }

    expect(() => releaseApplicationRepositoryLock(forged)).toThrow("APPLICATION_PROPOSAL_LOCK_UNCERTAIN")
    expect(fs.readFileSync(claim.target, "utf8")).toBe(claim.text)
    expect(() => releaseApplicationRepositoryLock(claim)).not.toThrow()
  })

  it("reaps an owned exact release residue left after an interrupted unlink", async () => {
    const target = fixture()
    const repositoryDigest = applicationRepositoryLockIdentity(target.repositoryRoot)
    const value = {
      schemaVersion: 2,
      token: randomUUID(),
      processId: 2_147_483_647,
      processIdentity: "win:1234567890",
      startedAt: new Date().toISOString(),
      repositoryDigest,
      proposalId: randomUUID(),
    }
    const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`)
    const contentDigest = createHash("sha256").update(bytes).digest("hex")
    const directory = lockDirectory(target.runtimeRoot)
    fs.mkdirSync(directory, { recursive: true })
    const residue = path.join(
      directory,
      `${repositoryDigest}.lock.${contentDigest}.${randomUUID()}.release`,
    )
    fs.writeFileSync(residue, bytes)

    await expect(withApplicationRepositoryRecoveryClaim({
      ...target,
      action: async () => "recovered",
    })).resolves.toBe("recovered")
    expect(fs.readdirSync(directory)).toEqual([])
  })

  it("skips a live release residue while another process acquires the repository lock", async () => {
    const target = fixture()
    const stalled = await stalledRepositoryLockRelease(target.runtimeRoot, target.repositoryRoot)

    const claim = await acquireApplicationRepositoryLock({
      ...target,
      proposalId: randomUUID(),
      recoverStale: async () => undefined,
    })
    releaseApplicationRepositoryLock(claim)
    await hardKill(stalled)
    await expect(withApplicationRepositoryRecoveryClaim({
      ...target,
      action: async () => "recovered",
    })).resolves.toBe("recovered")
    expect(fs.readdirSync(lockDirectory(target.runtimeRoot))).toEqual([])
  })

  it("accepts an exact dead residue removed after its identity check by a concurrent sweeper", async () => {
    const target = fixture()
    const repositoryDigest = applicationRepositoryLockIdentity(target.repositoryRoot)
    const token = randomUUID()
    const residue = writePrivateResidue({
      ...target,
      publicName: `${repositoryDigest}.reap-${token}.json`,
      value: {
        schemaVersion: 2,
        token,
        processId: process.pid,
        processIdentity: applicationProposalProcessIdentity(),
        startedAt: new Date().toISOString(),
        repositoryDigest,
        ticket: 0,
      },
    })
    let raced = false

    await expect(withApplicationRepositoryRecoveryClaim({
      ...target,
      transactionOperations: {
        checkpoint(stage: string) {
          if (stage !== "private_lock_residue_unlinking" || raced) return
          fs.unlinkSync(residue)
          raced = true
        },
      },
      action: async () => "recovered",
    })).resolves.toBe("recovered")
    expect(raced).toBe(true)
    expect(fs.readdirSync(lockDirectory(target.runtimeRoot))).toEqual([])
  })

  it("retains and fails closed on an invalid exact-name residue", async () => {
    const target = fixture()
    const repositoryDigest = applicationRepositoryLockIdentity(target.repositoryRoot)
    const token = randomUUID()
    const residue = writePrivateResidue({
      ...target,
      publicName: `${repositoryDigest}.reap-${token}.json`,
      value: {},
      bytes: Buffer.from("not-json\n"),
    })

    await expect(withApplicationRepositoryRecoveryClaim({
      ...target,
      action: async () => "must not run",
    })).rejects.toThrow("APPLICATION_PROPOSAL_LOCK_UNCERTAIN")
    expect(fs.readFileSync(residue, "utf8")).toBe("not-json\n")
  })

  it("retains and fails closed on a multiply-linked exact residue", async () => {
    const target = fixture()
    const repositoryDigest = applicationRepositoryLockIdentity(target.repositoryRoot)
    const token = randomUUID()
    const residue = writePrivateResidue({
      ...target,
      publicName: `${repositoryDigest}.reap-${token}.json`,
      value: {
        schemaVersion: 2,
        token,
        processId: process.pid,
        processIdentity: applicationProposalProcessIdentity(),
        startedAt: new Date().toISOString(),
        repositoryDigest,
        ticket: 0,
      },
    })
    const secondName = `${residue}.linked`
    fs.linkSync(residue, secondName)

    await expect(withApplicationRepositoryRecoveryClaim({
      ...target,
      action: async () => "must not run",
    })).rejects.toThrow("APPLICATION_PROPOSAL_LOCK_UNCERTAIN")
    expect(fs.statSync(residue, { bigint: true }).nlink).toBe(2n)
    expect(fs.statSync(secondName, { bigint: true }).nlink).toBe(2n)
  })
})

describe("application proposal repository-lock record codec", () => {
  it.each([
    [1, true],
    [2, false],
  ] as const)("rejects schema v%s repository locks with processIdentity=%s", async (schemaVersion, includeIdentity) => {
    const target = fixture()
    const repositoryDigest = applicationRepositoryLockIdentity(target.repositoryRoot)
    const lockPath = applicationRepositoryLockPath(target.runtimeRoot, target.repositoryRoot)
    fs.mkdirSync(path.dirname(lockPath), { recursive: true })
    fs.writeFileSync(lockPath, `${JSON.stringify({
      schemaVersion,
      token: randomUUID(),
      processId: process.pid,
      ...(includeIdentity ? { processIdentity: applicationProposalProcessIdentity() } : {}),
      startedAt: new Date().toISOString(),
      repositoryDigest,
      proposalId: randomUUID(),
    }, null, 2)}\n`)

    await expect(acquireApplicationRepositoryLock({
      ...target,
      proposalId: randomUUID(),
      recoverStale: async () => { throw new Error("invalid record must not be recovered") },
    })).rejects.toThrow("APPLICATION_PROPOSAL_LOCK_UNCERTAIN")
  })

  it.each([
    [1, true],
    [2, false],
  ] as const)("rejects schema v%s recovery claims with processIdentity=%s", async (schemaVersion, includeIdentity) => {
    const target = fixture()
    const repositoryDigest = applicationRepositoryLockIdentity(target.repositoryRoot)
    const token = randomUUID()
    const directory = lockDirectory(target.runtimeRoot)
    fs.mkdirSync(directory, { recursive: true })
    fs.writeFileSync(path.join(directory, `${repositoryDigest}.reap-${token}.json`), `${JSON.stringify({
      schemaVersion,
      token,
      processId: process.pid,
      ...(includeIdentity ? { processIdentity: applicationProposalProcessIdentity() } : {}),
      startedAt: new Date().toISOString(),
      repositoryDigest,
      ticket: 1,
    }, null, 2)}\n`)

    await expect(withApplicationRepositoryRecoveryClaim({
      ...target,
      waitMs: 25,
      action: async () => "must not run",
    })).rejects.toThrow("APPLICATION_PROPOSAL_LOCK_UNCERTAIN")
  })

  it("keeps legacy identity-free v1 repository locks recoverable", async () => {
    const target = fixture()
    const repositoryDigest = applicationRepositoryLockIdentity(target.repositoryRoot)
    const lockPath = applicationRepositoryLockPath(target.runtimeRoot, target.repositoryRoot)
    fs.mkdirSync(path.dirname(lockPath), { recursive: true })
    fs.writeFileSync(lockPath, `${JSON.stringify({
      schemaVersion: 1,
      token: randomUUID(),
      processId: 2_147_483_647,
      startedAt: new Date().toISOString(),
      repositoryDigest,
      proposalId: randomUUID(),
    }, null, 2)}\n`)
    let recovered = false

    const claim = await acquireApplicationRepositoryLock({
      ...target,
      proposalId: randomUUID(),
      recoverStale: async () => { recovered = true },
    })
    expect(recovered).toBe(true)
    expect(claim.value.schemaVersion).toBe(2)
    releaseApplicationRepositoryLock(claim)
    expect(fs.readdirSync(lockDirectory(target.runtimeRoot))).toEqual([])
  })

  it("keeps legacy identity-free v1 recovery claims reapable", async () => {
    const target = fixture()
    const repositoryDigest = applicationRepositoryLockIdentity(target.repositoryRoot)
    const token = randomUUID()
    const directory = lockDirectory(target.runtimeRoot)
    fs.mkdirSync(directory, { recursive: true })
    fs.writeFileSync(path.join(directory, `${repositoryDigest}.reap-${token}.json`), `${JSON.stringify({
      schemaVersion: 1,
      token,
      processId: 2_147_483_647,
      startedAt: new Date().toISOString(),
      repositoryDigest,
      ticket: 1,
    }, null, 2)}\n`)

    await expect(withApplicationRepositoryRecoveryClaim({
      ...target,
      action: async () => "recovered",
    })).resolves.toBe("recovered")
    expect(fs.readdirSync(directory)).toEqual([])
  })
})
