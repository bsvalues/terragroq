import { execFileSync, spawn } from "node:child_process"
import { createHash, randomUUID } from "node:crypto"
import { once } from "node:events"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

import { afterEach, describe, expect, it, vi } from "vitest"

import { createProposalEngine } from "@/lib/applications/proposal-engine.mjs"
import { deleteOwnedProposalBranch } from "@/lib/applications/proposal-transaction-core.mjs"
import { readApplicationRepository } from "@/lib/applications/application-catalog"
import {
  applyApplicationProposal,
  createApplicationProposal,
  getApplicationProposal,
  listApplicationProposals,
  reconcileApplicationProposalCreateIntents,
  rejectApplicationProposal,
} from "@/lib/applications/application-proposal-service.mjs"
import {
  acquireApplicationRepositoryLock,
  applicationProposalProcessIdentity,
  applicationRepositoryLockIdentity,
  applicationRepositoryLockPath,
  releaseApplicationRepositoryLock,
  withApplicationRepositoryRecoveryClaim,
} from "@/lib/applications/proposal-repository-lock.mjs"
import {
  listApplicationProposalCreateIntents,
  publishApplicationProposalCreateIntent,
  releaseApplicationProposalCreateIntent,
} from "@/lib/applications/proposal-create-journal.mjs"
import {
  HELLO_APPLICATION_ALLOWED_PATHS,
  governedPrompt as helloGovernedPrompt,
} from "@/lib/hello-application/proposal-service.mjs"

// Full canonical Git/config/ref revalidation intentionally adds several
// subprocess boundaries to lifecycle tests; keep the file-level gate bounded
// without relying on the runner's 5s unit-test default.
vi.setConfig({ testTimeout: 15_000 })

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }) })

function git(root: string, ...args: string[]) {
  return execFileSync("git", ["-C", root, ...args], { encoding: "utf8", windowsHide: true }).trim()
}

const gitShellPath = (target: string) => process.platform === "win32"
  ? target.replace(/^([A-Za-z]):/, (_match, drive: string) => `/${drive.toLowerCase()}`).replaceAll("\\", "/")
  : target

async function fixture(id: string) {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), `application-proposal-${id}-`))
  roots.push(parent)
  const repositoryRoot = path.join(parent, id)
  const runtimeRoot = path.join(parent, "runtime")
  fs.mkdirSync(repositoryRoot)
  const manifest = {
    schemaVersion: 1,
    id,
    displayName: id === "focus-board" ? "Focus Board" : "Notes Pad",
    adapter: "static-web-v1",
    source: { document: "web/page.html", styles: "assets/theme.css", script: "client/main.js", test: "test/application.test.mjs" },
    ai: { writablePaths: ["web/page.html", "assets/theme.css", "client/main.js"] },
  }
  const files: Record<string, string> = {
    ".williamos/application.json": `${JSON.stringify(manifest, null, 2)}\n`,
    "web/page.html": "<main>Board</main>\n",
    "assets/theme.css": "main { color: navy; }\n",
    "client/main.js": "document.body.dataset.ready = 'true'\n",
    "test/application.test.mjs": "import test from 'node:test'\nimport assert from 'node:assert/strict'\ntest('app', () => assert.ok(true))\n",
    "owner-notes.txt": "owner base\n",
  }
  for (const [relative, content] of Object.entries(files)) {
    const target = path.join(repositoryRoot, ...relative.split("/"))
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, content)
  }
  execFileSync("git", ["init", "-b", "main", repositoryRoot], { windowsHide: true })
  git(repositoryRoot, "config", "user.name", "Test")
  git(repositoryRoot, "config", "user.email", "test@example.invalid")
  git(repositoryRoot, "add", ".")
  git(repositoryRoot, "commit", "-m", "initial")
  return { repositoryRoot, runtimeRoot, application: await readApplicationRepository(repositoryRoot, id) }
}

const validation = async () => ({ status: "passed", command: "node --test test/application.test.mjs", output: "ok" })

function externalTurn(changes: Record<string, string>) {
  return async ({ workspacePath, model }: { workspacePath: string; model: string }) => {
    for (const [relative, content] of Object.entries(changes)) fs.writeFileSync(path.join(workspacePath, ...relative.split("/")), content)
    return {
      threadId: "cerebras-1234",
      turnId: "turn-1234",
      model,
      executionNode: "cerebras-api",
      ignoredPathsCreated: [],
      providerExecution: {
        route: "external", provider: "cerebras", bridgeNode: "hermes-node", inferenceNode: "cerebras-api",
        mode: "credential-bridge-one-shot", requestedModel: model, actualModel: model, externalEgress: true,
        promptTokens: 10, completionTokens: 5, totalTokens: 15, calculatedCostUsd: 0.001, maxCostUsd: 0.03,
        contextDigest: `sha256:${"c".repeat(64)}`, durationMs: 8,
      },
    }
  }
}

async function abandonedRepositoryLock(runtimeRoot: string, repositoryRoot: string, proposalId: string, hold = false) {
  const moduleUrl = pathToFileURL(path.join(process.cwd(), "lib/applications/proposal-repository-lock.mjs")).href
  const script = `
    import { acquireApplicationRepositoryLock } from ${JSON.stringify(moduleUrl)};
    const claim = await acquireApplicationRepositoryLock({
      runtimeRoot: ${JSON.stringify(runtimeRoot)},
      repositoryRoot: ${JSON.stringify(repositoryRoot)},
      proposalId: ${JSON.stringify(proposalId)},
      recoverStale: async () => { throw new Error("unexpected stale lock") },
    });
    process.stdout.write(JSON.stringify(claim.value) + "\\n");
    ${hold ? "setInterval(() => {}, 1000);" : ""}
  `
  const child = spawn(process.execPath, ["--input-type=module", "-e", script], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true })
  const [chunk] = await once(child.stdout, "data") as [Buffer]
  const claim = JSON.parse(chunk.toString("utf8").trim())
  if (!hold) await once(child, "close")
  return { child, claim }
}

async function abandonedRepositoryRecoveryClaim(runtimeRoot: string, repositoryRoot: string) {
  const moduleUrl = pathToFileURL(path.join(process.cwd(), "lib/applications/proposal-repository-lock.mjs")).href
  const script = `
    import { withApplicationRepositoryRecoveryClaim } from ${JSON.stringify(moduleUrl)};
    await withApplicationRepositoryRecoveryClaim({
      runtimeRoot: ${JSON.stringify(runtimeRoot)},
      repositoryRoot: ${JSON.stringify(repositoryRoot)},
      action: async () => {
        process.stdout.write("acquired\\n");
        await new Promise(() => setInterval(() => {}, 1000));
      },
    });
  `
  const child = spawn(process.execPath, ["--input-type=module", "-e", script], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true })
  await once(child.stdout, "data")
  child.kill()
  await once(child, "close")
}

async function crashedRepositoryLockPublication(
  runtimeRoot: string,
  repositoryRoot: string,
  crashStage: "recovery_claim_linked" | "repository_lock_linked",
) {
  const moduleUrl = pathToFileURL(path.join(process.cwd(), "lib/applications/proposal-repository-lock.mjs")).href
  const script = `
    import {
      acquireApplicationRepositoryLock,
      withApplicationRepositoryRecoveryClaim,
    } from ${JSON.stringify(moduleUrl)};
    const checkpoint = (stage) => {
      if (stage !== ${JSON.stringify(crashStage)}) return;
      process.stdout.write(stage + "\\n");
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
    };
    if (${JSON.stringify(crashStage)} === "recovery_claim_linked") {
      await withApplicationRepositoryRecoveryClaim({
        runtimeRoot: ${JSON.stringify(runtimeRoot)},
        repositoryRoot: ${JSON.stringify(repositoryRoot)},
        action: async () => "unreachable",
        transactionOperations: { checkpoint },
      });
    } else {
      await acquireApplicationRepositoryLock({
        runtimeRoot: ${JSON.stringify(runtimeRoot)},
        repositoryRoot: ${JSON.stringify(repositoryRoot)},
        proposalId: "11111111-1111-4111-8111-111111111111",
        recoverStale: async () => {},
        transactionOperations: { checkpoint },
      });
    }
  `
  const child = spawn(process.execPath, ["--input-type=module", "-e", script], {
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  })
  let stderr = ""
  child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8") })
  const closed = once(child, "close") as Promise<[number | null, NodeJS.Signals | null]>
  await Promise.race([
    once(child.stdout, "data"),
    closed.then(([code]) => { throw new Error(`lock crash helper exited ${code}: ${stderr}`) }),
  ])
  if (!child.kill("SIGKILL")) throw new Error("lock crash helper could not be terminated")
  await closed
}

async function crashedApplicationCreate(
  application: Awaited<ReturnType<typeof readApplicationRepository>>,
  runtimeRoot: string,
  crashStage = "worktree_created",
) {
  const serviceUrl = pathToFileURL(path.join(process.cwd(), "lib/applications/application-proposal-service.mjs")).href
  const identityUrl = pathToFileURL(path.join(process.cwd(), "lib/applications/application-identity.mjs")).href
  const script = `
    import fs from "node:fs";
    import { createApplicationProposal } from ${JSON.stringify(serviceUrl)};
    import { bindCatalogApplication } from ${JSON.stringify(identityUrl)};
    const application = Object.freeze(${JSON.stringify(application)});
    bindCatalogApplication(application, { repositoryRoot: application.repositoryRoot });
    await createApplicationProposal({
      application,
      runtimeRoot: ${JSON.stringify(runtimeRoot)},
      requestedBy: "crash-owner",
      requestText: "Hold after the isolated worktree is created",
      executionRoute: "hermes-local",
      residentTurn: async ({ workspacePath }) => {
        fs.writeFileSync(workspacePath + "/web/page.html", "<main>Crash candidate</main>\\n");
        return {
          threadId: "crash-thread", turnId: "crash-turn", model: "williamos-qwen3-4b:64k",
          executionNode: "hermes-node", ignoredPathsCreated: [],
        };
      },
      validateWorkspace: async () => ({ status: "passed", command: "node --test test/application.test.mjs", output: "ok" }),
      transactionOperations: {
        checkpoint: async (stage) => {
          if (stage !== ${JSON.stringify(crashStage)}) return;
          process.stdout.write(stage + "\\n");
          await new Promise(() => {});
        },
      },
    });
  `
  const child = spawn(process.execPath, ["--input-type=module", "-e", script], {
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  })
  let stderr = ""
  child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8") })
  const closed = once(child, "close") as Promise<[number | null, NodeJS.Signals | null]>
  try {
    await Promise.race([
      once(child.stdout, "data"),
      closed.then(([code]) => { throw new Error(`crash helper exited ${code}: ${stderr}`) }),
    ])
    if (!child.kill("SIGKILL")) throw new Error("crash helper could not be terminated")
    let timer: NodeJS.Timeout | undefined
    try {
      await Promise.race([
        closed,
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("crash helper termination timed out")), 5_000) }),
      ])
    } finally { if (timer) clearTimeout(timer) }
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL")
  }
}

describe("application proposal engine compatibility", () => {
  it("builds literal manifest-bound prompts while preserving the Hello delegate", () => {
    const engine = createProposalEngine({
      applicationId: "focus-board",
      displayName: "Focus Board",
      allowedPaths: ["web/page.html", "assets/theme.css", "client/main.js"],
      validationPaths: ["web/page.html", "assets/theme.css", "client/main.js", "test/application.test.mjs"],
      validationCommand: "node --test test/application.test.mjs",
      namespace: "application-proposals/focus-board",
      receiptSchemaVersion: 4,
    })

    expect(engine.allowedPaths).toEqual(["web/page.html", "assets/theme.css", "client/main.js"])
    expect(engine.governedPrompt("Add a reset button")).toContain("Focus Board (focus-board)")
    expect(engine.governedPrompt("Add a reset button")).toContain("web/page.html, assets/theme.css, client/main.js")
    expect(engine.governedPrompt("Add a reset button")).toContain("node --test test/application.test.mjs")

    expect(HELLO_APPLICATION_ALLOWED_PATHS).toEqual([
      "examples/hello-application/src/app.js",
      "examples/hello-application/src/index.html",
      "examples/hello-application/src/styles.css",
    ])
    expect(helloGovernedPrompt("Change the greeting")).toContain("isolated Hello Application workspace")
  })

  it("distinguishes an absent proposal branch from a failed branch observation", async () => {
    const absent = vi.fn(async () => ({ code: 1, executionFailure: false, stdout: "", stderr: "" }))
    await expect(deleteOwnedProposalBranch({
      git: absent,
      repository: "unused",
      branch: "codex/williamos-app-focus-board-11111111-1111-4111-8111-111111111111",
      ownedTargets: new Set(),
      errorCode: "APPLICATION_PROPOSAL_ARTIFACT_CLEANUP_FAILED",
    })).resolves.toBe(false)

    const failed = vi.fn(async () => ({ code: -1, executionFailure: true, stdout: "", stderr: "spawn failed" }))
    await expect(deleteOwnedProposalBranch({
      git: failed,
      repository: "unused",
      branch: "codex/williamos-app-focus-board-11111111-1111-4111-8111-111111111111",
      ownedTargets: new Set(),
      errorCode: "APPLICATION_PROPOSAL_ARTIFACT_CLEANUP_FAILED",
    })).rejects.toThrow("APPLICATION_PROPOSAL_ARTIFACT_CLEANUP_FAILED")
  })
})

describe("application proposal lifecycle", () => {
  it.each(["terrafusion", "williamos", "hello-application", "con"]) (
    "rejects reserved application identity %s at the direct service boundary",
    async (reservedId) => {
      const { application, runtimeRoot } = await fixture("focus-board")
      const reservedApplication = { ...application, manifest: { ...application.manifest, id: reservedId } }
      await expect(createApplicationProposal({
        application: reservedApplication,
        runtimeRoot,
        requestedBy: "owner-1",
        requestText: "Change the theme",
        executionRoute: "cerebras-qwen-3-8-27b",
        externalRoutingEnabled: true,
        externalEgressApproved: true,
        cerebrasTurn: externalTurn({ "assets/theme.css": "main { color: teal; }\n" }),
        validateWorkspace: validation,
      })).rejects.toThrow("APPLICATION_PROPOSAL_MANIFEST_INVALID")
    },
  )

  it("reads durable resident evidence and refuses kernel-reported ignored writes", async () => {
    const { assertResidentProposalRuntimePolicy, readResidentProposalEvidence } = await import("@/lib/applications/resident-proposal-turn.mjs")
    const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "application-resident-evidence-"))
    roots.push(runtimeRoot)
    const workspacePath = path.join(runtimeRoot, "worktrees", "focus-board-proposal")
    fs.mkdirSync(workspacePath, { recursive: true })
    const threadId = "11111111-1111-4111-8111-111111111111"
    const turnId = "22222222-2222-4222-8222-222222222222"
    const turnRoot = path.join(runtimeRoot, "hermes-kernel", "threads", threadId, "turns", "1")
    fs.mkdirSync(turnRoot, { recursive: true })
    const packet = {
      schemaVersion: 3,
      runId: turnId,
      workspaceMode: "OWNED_WORKTREE",
      workspacePath,
      model: "williamos-qwen3-4b:64k",
      placement: { computeId: "hermes-node" },
    }
    const packetBytes = Buffer.from(`${JSON.stringify(packet)}\n`)
    fs.writeFileSync(path.join(turnRoot, "packet.json"), packetBytes)
    const sessionPath = path.join(runtimeRoot, "hermes-kernel", "threads", threadId, "session.json")
    const writeSession = (ignoredPathsCreated?: string[]) => fs.writeFileSync(sessionPath, `${JSON.stringify({
      schemaVersion: 1,
      threadId,
      workspacePath,
      turns: [{
        turnId,
        exitCode: 0,
        harvested: true,
        packetSha256: createHash("sha256").update(packetBytes).digest("hex"),
        ...(ignoredPathsCreated === undefined ? {} : { ignoredPathsCreated }),
      }],
    })}\n`)
    const input = {
      runtimeRoot,
      workspacePath,
      threadId,
      outcomes: [{ turn: { threadId, turnId, status: "completed" } }],
      reviewed: { placement: { executionNode: "hermes-node" } },
      errorPrefix: "APPLICATION_PROPOSAL",
    }
    writeSession()
    expect(readResidentProposalEvidence(input)).toEqual({
      turnId,
      model: "williamos-qwen3-4b:64k",
      executionNode: "hermes-node",
      ignoredPathsCreated: [],
    })
    writeSession(["ignored-cache.bin"])
    expect(() => readResidentProposalEvidence(input)).toThrow("APPLICATION_PROPOSAL_IGNORED_PATH_REFUSED")

    const policy = {
      placement: { allowedWorkspaceRoots: [path.join(runtimeRoot, "worktrees")] },
      containment: { agentStatePersistence: "PER_THREAD_STATE_DIR" },
    }
    expect(assertResidentProposalRuntimePolicy(policy, runtimeRoot)).toBe(policy)
    expect(() => assertResidentProposalRuntimePolicy({
      ...policy,
      placement: { allowedWorkspaceRoots: [path.join(runtimeRoot, "some-other-worktrees")] },
    }, runtimeRoot)).toThrow("APPLICATION_PROPOSAL_POLICY_INVALID")
  })

  it("places the local-authoring worktree in the resident runtime's owned worktrees directory", async () => {
    const { application, runtimeRoot } = await fixture("focus-board")
    const proposal = await createApplicationProposal({
      application,
      runtimeRoot,
      requestedBy: "owner-1",
      requestText: "Add reset behavior",
      executionRoute: "hermes-local",
      residentTurn: async ({ workspacePath, runtimeRoot: selectedRuntime }: { workspacePath: string; runtimeRoot: string }) => {
        expect(path.dirname(workspacePath)).toBe(path.join(runtimeRoot, "worktrees"))
        expect(selectedRuntime).toBe(runtimeRoot)
        fs.writeFileSync(path.join(workspacePath, "client/main.js"), "document.body.dataset.reset = 'ready'\n")
        return {
          threadId: "local-thread",
          turnId: "local-turn",
          model: "williamos-qwen3-4b:64k",
          executionNode: "hermes-node",
          ignoredPathsCreated: [],
        }
      },
      validateWorkspace: validation,
    })
    expect(proposal).toEqual(expect.objectContaining({
      executionRoute: "hermes-local",
      executionProvider: "hermes-local",
      executionNode: "hermes-node",
    }))
  })

  it("scavenges a hard-crashed CREATE from its durable application-bound intent", async () => {
    const focus = await fixture("focus-board")
    await crashedApplicationCreate(focus.application, focus.runtimeRoot)

    const intentRoot = path.join(focus.runtimeRoot, "application-proposal-create-intents", "focus-board")
    const intentNames = fs.readdirSync(intentRoot)
    expect(intentNames).toHaveLength(1)
    const intentText = fs.readFileSync(path.join(intentRoot, intentNames[0]), "utf8")
    const intent = JSON.parse(intentText)
    expect(intent).toEqual(expect.objectContaining({
      schemaVersion: 2,
      applicationId: "focus-board",
      manifestDigest: focus.application.manifestDigest,
      repositoryDigest: applicationRepositoryLockIdentity(focus.repositoryRoot),
      baseSha: focus.application.head,
      processId: expect.any(Number),
    }))
    expect(intentText).not.toContain(focus.repositoryRoot)
    expect(intentText).not.toContain(focus.runtimeRoot)
    expect(git(focus.repositoryRoot, "worktree", "list", "--porcelain").match(/^worktree /gm)).toHaveLength(2)

    await expect(createApplicationProposal({
      application: focus.application,
      runtimeRoot: focus.runtimeRoot,
      requestedBy: "owner",
      requestText: "Create a fresh proposal after recovery",
      executionRoute: "hermes-local",
      residentTurn: async ({ workspacePath }: { workspacePath: string }) => {
        fs.writeFileSync(path.join(workspacePath, "web/page.html"), "<main>Recovered</main>\n")
        return {
          threadId: "local-thread", turnId: "local-turn", model: "williamos-qwen3-4b:64k",
          executionNode: "hermes-node", ignoredPathsCreated: [],
        }
      },
      validateWorkspace: validation,
    })).resolves.toEqual(expect.objectContaining({ status: "READY_FOR_REVIEW" }))

    expect(fs.readdirSync(intentRoot)).toEqual([])
    expect(() => git(focus.repositoryRoot, "show-ref", "--verify", "--quiet", `refs/heads/${intent.branch}`)).toThrow()
    expect(git(focus.repositoryRoot, "worktree", "list", "--porcelain").match(/^worktree /gm)).toHaveLength(1)
  }, 60_000)

  it("fails closed before enumerating an unbounded CREATE recovery directory", async () => {
    const focus = await fixture("focus-board")
    const intentRoot = path.join(focus.runtimeRoot, "application-proposal-create-intents", "focus-board")
    fs.mkdirSync(intentRoot, { recursive: true })
    const processIdentity = applicationProposalProcessIdentity()
    for (let index = 0; index < 129; index += 1) {
      const proposalId = randomUUID()
      const intentToken = randomUUID()
      fs.writeFileSync(path.join(intentRoot, `${proposalId}.json`), `${JSON.stringify({
        schemaVersion: 2,
        applicationId: "focus-board",
        proposalId,
        manifestDigest: focus.application.manifestDigest,
        repositoryDigest: applicationRepositoryLockIdentity(focus.repositoryRoot),
        writablePaths: focus.application.manifest.ai.writablePaths,
        baseRef: "refs/heads/main",
        baseSha: focus.application.head,
        branch: `codex/williamos-app-focus-board-${proposalId}`,
        workspaceName: `focus-board-${proposalId}`,
        intentToken,
        processId: process.pid,
        processIdentity,
        startedAt: new Date().toISOString(),
        phase: "WORKTREE_PENDING",
        candidateSha: null,
        changedPaths: null,
        patchSha256: null,
        receiptSha256: null,
      })}\n`)
    }

    expect(() => listApplicationProposalCreateIntents(focus.runtimeRoot, "focus-board"))
      .toThrow("APPLICATION_PROPOSAL_CREATION_RECOVERY_UNCERTAIN")

    for (const name of fs.readdirSync(intentRoot)) fs.unlinkSync(path.join(intentRoot, name))
    for (let index = 0; index < 33; index += 1) {
      const proposalId = randomUUID()
      const intentToken = randomUUID()
      fs.writeFileSync(path.join(intentRoot, `${proposalId}.json`), `${JSON.stringify({
        schemaVersion: 2,
        applicationId: "focus-board",
        proposalId,
        manifestDigest: focus.application.manifestDigest,
        repositoryDigest: applicationRepositoryLockIdentity(focus.repositoryRoot),
        writablePaths: focus.application.manifest.ai.writablePaths,
        baseRef: "refs/heads/main",
        baseSha: focus.application.head,
        branch: `codex/williamos-app-focus-board-${proposalId}`,
        workspaceName: `focus-board-${proposalId}`,
        intentToken,
        processId: process.pid,
        processIdentity,
        startedAt: new Date().toISOString(),
        phase: "WORKTREE_PENDING",
        candidateSha: null,
        changedPaths: null,
        patchSha256: null,
        receiptSha256: null,
      })}\n`)
    }
    expect(() => listApplicationProposalCreateIntents(focus.runtimeRoot, "focus-board"))
      .toThrow("APPLICATION_PROPOSAL_CREATION_RECOVERY_UNCERTAIN")
  })

  it("refuses the 33rd live CREATE intent and admits one after capacity is released", async () => {
    const focus = await fixture("focus-board")
    const repositoryDigest = applicationRepositoryLockIdentity(focus.repositoryRoot)
    const handles = Array.from({ length: 32 }, () => {
      const proposalId = randomUUID()
      return publishApplicationProposalCreateIntent({
        runtimeRoot: focus.runtimeRoot,
        applicationId: "focus-board",
        proposalId,
        manifestDigest: focus.application.manifestDigest,
        repositoryDigest,
        writablePaths: focus.application.manifest.ai.writablePaths,
        baseRef: "refs/heads/main",
        baseSha: focus.application.head,
        branch: `codex/williamos-app-focus-board-${proposalId}`,
        workspaceName: `focus-board-${proposalId}`,
        intentToken: randomUUID(),
        startedAt: new Date().toISOString(),
      })
    })
    const create = () => createApplicationProposal({
      application: focus.application,
      runtimeRoot: focus.runtimeRoot,
      requestedBy: "owner",
      requestText: "Admit only within bounded CREATE capacity",
      executionRoute: "hermes-local",
      residentTurn: async ({ workspacePath }: { workspacePath: string }) => {
        fs.writeFileSync(path.join(workspacePath, "web/page.html"), "<main>Capacity admitted</main>\n")
        return {
          threadId: "local-thread", turnId: "local-turn", model: "williamos-qwen3-4b:64k",
          executionNode: "hermes-node", ignoredPathsCreated: [],
        }
      },
      validateWorkspace: validation,
    })
    try {
      await expect(create()).rejects.toThrow("APPLICATION_PROPOSAL_REPOSITORY_BUSY")
      expect(listApplicationProposalCreateIntents(focus.runtimeRoot, "focus-board")).toHaveLength(32)
      releaseApplicationProposalCreateIntent(handles.shift()!)
      await expect(create()).resolves.toEqual(expect.objectContaining({ status: "READY_FOR_REVIEW" }))
    } finally {
      for (const handle of handles) releaseApplicationProposalCreateIntent(handle)
    }
  }, 30_000)

  it.each([
    "intent_published",
    "candidate_bound",
    "candidate_published",
    "worktree_removed",
    "publication_bound",
    "patch_private_partial",
    "patch_published",
    "receipt_staged",
    "receipt_published",
  ])("recovers a hard process death at CREATE checkpoint %s", async (crashStage) => {
    const focus = await fixture("focus-board")
    await crashedApplicationCreate(focus.application, focus.runtimeRoot, crashStage)
    const intentRoot = path.join(focus.runtimeRoot, "application-proposal-create-intents", "focus-board")
    const baseName = fs.readdirSync(intentRoot).find((name) => /^[0-9a-f-]{36}\.json$/i.test(name))
    expect(baseName).toBeTruthy()
    const intent = JSON.parse(fs.readFileSync(path.join(intentRoot, baseName!), "utf8"))

    await reconcileApplicationProposalCreateIntents({
      application: focus.application,
      runtimeRoot: focus.runtimeRoot,
    })

    expect(fs.readdirSync(intentRoot)).toEqual([])
    expect(git(focus.repositoryRoot, "worktree", "list", "--porcelain").match(/^worktree /gm)).toHaveLength(1)
    if (crashStage === "receipt_published") {
      expect(getApplicationProposal({
        applicationId: "focus-board",
        runtimeRoot: focus.runtimeRoot,
        proposalId: intent.proposalId,
        requestedBy: "crash-owner",
      })).toEqual(expect.objectContaining({ status: "READY_FOR_REVIEW", candidateSha: expect.any(String) }))
      expect(git(focus.repositoryRoot, "show-ref", "--hash", "--verify", `refs/heads/${intent.branch}`)).toMatch(/^[0-9a-f]{40,64}$/)
    } else {
      expect(fs.existsSync(path.join(focus.runtimeRoot, "application-proposals", "focus-board", `${intent.proposalId}.json`))).toBe(false)
      expect(fs.existsSync(path.join(focus.runtimeRoot, "application-proposals", "focus-board", `${intent.proposalId}.patch`))).toBe(false)
      expect(() => git(focus.repositoryRoot, "show-ref", "--verify", "--quiet", `refs/heads/${intent.branch}`)).toThrow()
      expect(git(focus.repositoryRoot, "rev-parse", "HEAD")).toBe(focus.application.head)
      expect(fs.readFileSync(path.join(focus.repositoryRoot, "web/page.html"), "utf8")).toBe("<main>Board</main>\n")
    }
  }, 30_000)

  it("reconciles an owned Git candidate-index lock sidecar after hard process death", async () => {
    const focus = await fixture("focus-board")
    await crashedApplicationCreate(focus.application, focus.runtimeRoot, "candidate_bound")
    const intentRoot = path.join(focus.runtimeRoot, "application-proposal-create-intents", "focus-board")
    const baseName = fs.readdirSync(intentRoot).find((name) => /^[0-9a-f-]{36}\.json$/i.test(name))!
    const intent = JSON.parse(fs.readFileSync(path.join(intentRoot, baseName), "utf8"))
    const workspace = path.join(focus.runtimeRoot, "worktrees", intent.workspaceName)
    const candidateIndex = `${workspace}.candidate-index-${intent.intentToken}`
    const candidateIndexLock = `${candidateIndex}.lock`
    expect(fs.existsSync(candidateIndex)).toBe(true)
    fs.writeFileSync(candidateIndexLock, "interrupted Git index writer\n")

    await reconcileApplicationProposalCreateIntents({
      application: focus.application,
      runtimeRoot: focus.runtimeRoot,
    })

    expect(fs.existsSync(candidateIndex)).toBe(false)
    expect(fs.existsSync(candidateIndexLock)).toBe(false)
    expect(fs.readdirSync(intentRoot)).toEqual([])
  }, 30_000)

  it("removes a private CREATE journal write when publication fails before linking", async () => {
    const focus = await fixture("focus-board")
    const realWrite = fs.writeSync
    let failed = false
    const write = vi.spyOn(fs, "writeSync").mockImplementation(((descriptor: number, value: any, ...args: any[]) => {
      if (!failed && Buffer.isBuffer(value) && value.includes(Buffer.from('"phase": "WORKTREE_PENDING"'))) {
        failed = true
        throw new Error("simulated journal write failure")
      }
      return (realWrite as any)(descriptor, value, ...args)
    }) as typeof fs.writeSync)
    try {
      await expect(createApplicationProposal({
        application: focus.application,
        runtimeRoot: focus.runtimeRoot,
        requestedBy: "owner",
        requestText: "Never reaches the resident",
        executionRoute: "hermes-local",
        residentTurn: async () => { throw new Error("resident should not run") },
        validateWorkspace: validation,
      })).rejects.toThrow("APPLICATION_PROPOSAL_CREATION_RECOVERY_UNCERTAIN")
    } finally { write.mockRestore() }

    const intentRoot = path.join(focus.runtimeRoot, "application-proposal-create-intents", "focus-board")
    expect(fs.existsSync(intentRoot) ? fs.readdirSync(intentRoot) : []).toEqual([])
    expect(git(focus.repositoryRoot, "worktree", "list", "--porcelain").match(/^worktree /gm)).toHaveLength(1)
  })

  it.each(["candidate_bound", "publication_bound"])(
    "stops CREATE when the linked %s private record cannot be removed and later reconciles it",
    async (phase) => {
      const focus = await fixture("focus-board")
      const create = (text: string) => createApplicationProposal({
        application: focus.application,
        runtimeRoot: focus.runtimeRoot,
        requestedBy: "owner",
        requestText: text,
        executionRoute: "hermes-local",
        residentTurn: async ({ workspacePath }: { workspacePath: string }) => {
          fs.writeFileSync(path.join(workspacePath, "web/page.html"), `<main>${text}</main>\n`)
          return {
            threadId: "local-thread", turnId: "local-turn", model: "williamos-qwen3-4b:64k",
            executionNode: "hermes-node", ignoredPathsCreated: [],
          }
        },
        validateWorkspace: validation,
      })
      const realUnlink = fs.unlinkSync
      let failed = false
      const unlink = vi.spyOn(fs, "unlinkSync").mockImplementation(((target: fs.PathLike) => {
        if (!failed && String(target).endsWith(`.${phase}.write`)) {
          failed = true
          throw new Error("simulated linked journal residue")
        }
        return realUnlink(target)
      }) as typeof fs.unlinkSync)
      try {
        await expect(create("Interrupted phase")).rejects.toThrow("APPLICATION_PROPOSAL_CREATION_RECOVERY_UNCERTAIN")
      } finally { unlink.mockRestore() }

      expect(failed).toBe(true)
      const intentRoot = path.join(focus.runtimeRoot, "application-proposal-create-intents", "focus-board")
      expect(fs.readdirSync(intentRoot).some((name) => name.endsWith(`.${phase}.write`))).toBe(true)
      await reconcileApplicationProposalCreateIntents({ application: focus.application, runtimeRoot: focus.runtimeRoot })
      expect(fs.readdirSync(intentRoot)).toEqual([])
      await expect(create("Fresh phase")).resolves.toEqual(expect.objectContaining({ status: "READY_FOR_REVIEW" }))
    },
    30_000,
  )

  it("does not retain same-process liveness when the base-intent claim cleanup fails", async () => {
    const focus = await fixture("focus-board")
    const intentRoot = path.join(focus.runtimeRoot, "application-proposal-create-intents", "focus-board")
    const realUnlink = fs.unlinkSync
    let failuresRemaining = 3
    const unlink = vi.spyOn(fs, "unlinkSync").mockImplementation(((target: fs.PathLike) => {
      const value = String(target)
      if (failuresRemaining > 0 && value.includes("application-proposal-locks") && value.includes(".reap-")
        && fs.existsSync(intentRoot) && fs.readdirSync(intentRoot).some((name) => name.endsWith(".json"))) {
        failuresRemaining -= 1
        throw new Error("simulated post-action recovery-claim cleanup failure")
      }
      return realUnlink(target)
    }) as typeof fs.unlinkSync)
    try {
      await expect(createApplicationProposal({
        application: focus.application,
        runtimeRoot: focus.runtimeRoot,
        requestedBy: "owner",
        requestText: "Publish an intent before the claim cleanup fails",
        executionRoute: "hermes-local",
        residentTurn: async () => { throw new Error("resident should not run") },
        validateWorkspace: validation,
      })).rejects.toThrow("APPLICATION_PROPOSAL_LOCK_UNCERTAIN")
    } finally { unlink.mockRestore() }

    expect(failuresRemaining).toBe(0)
    expect(fs.readdirSync(intentRoot)).toHaveLength(1)
    await reconcileApplicationProposalCreateIntents({ application: focus.application, runtimeRoot: focus.runtimeRoot })
    expect(fs.readdirSync(intentRoot)).toEqual([])
  })

  it("reconciles a CREATE journal whose oldest release record was already deleted", async () => {
    const focus = await fixture("focus-board")
    const realUnlink = fs.unlinkSync
    let interrupted = false
    const unlink = vi.spyOn(fs, "unlinkSync").mockImplementation(((target: fs.PathLike) => {
      const value = String(target)
      if (!interrupted && value.includes("application-proposal-create-intents") && value.endsWith(".candidate.json")) {
        interrupted = true
        throw new Error("simulated release interruption")
      }
      return realUnlink(target)
    }) as typeof fs.unlinkSync)
    let proposal
    try {
      proposal = await createApplicationProposal({
        application: focus.application,
        runtimeRoot: focus.runtimeRoot,
        requestedBy: "owner",
        requestText: "Retain a durable proposal across journal release interruption",
        executionRoute: "hermes-local",
        residentTurn: async ({ workspacePath }: { workspacePath: string }) => {
          fs.writeFileSync(path.join(workspacePath, "web/page.html"), "<main>Durable</main>\n")
          return {
            threadId: "local-thread", turnId: "local-turn", model: "williamos-qwen3-4b:64k",
            executionNode: "hermes-node", ignoredPathsCreated: [],
          }
        },
        validateWorkspace: validation,
      })
    } finally { unlink.mockRestore() }

    expect(interrupted).toBe(true)
    const intentRoot = path.join(focus.runtimeRoot, "application-proposal-create-intents", "focus-board")
    expect(fs.readdirSync(intentRoot)).toHaveLength(2)
    await reconcileApplicationProposalCreateIntents({ application: focus.application, runtimeRoot: focus.runtimeRoot })
    expect(fs.readdirSync(intentRoot)).toEqual([])
    expect(getApplicationProposal({
      applicationId: "focus-board",
      runtimeRoot: focus.runtimeRoot,
      proposalId: proposal.proposalId,
      requestedBy: "owner",
    })).toEqual(expect.objectContaining({ status: "READY_FOR_REVIEW" }))
  })

  it("reconciles a legitimately rejected crash receipt while retaining one with drifted immutable provenance", async () => {
    const accepted = await fixture("focus-board")
    await crashedApplicationCreate(accepted.application, accepted.runtimeRoot, "receipt_published")
    const acceptedIntentRoot = path.join(accepted.runtimeRoot, "application-proposal-create-intents", "focus-board")
    const acceptedIntent = JSON.parse(fs.readFileSync(path.join(
      acceptedIntentRoot,
      fs.readdirSync(acceptedIntentRoot).find((name) => /^[0-9a-f-]{36}\.json$/i.test(name))!,
    ), "utf8"))
    await rejectApplicationProposal({
      application: accepted.application,
      runtimeRoot: accepted.runtimeRoot,
      proposalId: acceptedIntent.proposalId,
      requestedBy: "crash-owner",
      reason: "Legitimate terminal transition",
    })
    await expect(reconcileApplicationProposalCreateIntents({
      application: accepted.application,
      runtimeRoot: accepted.runtimeRoot,
    })).resolves.toBeUndefined()
    expect(fs.readdirSync(acceptedIntentRoot)).toEqual([])

    const drifted = await fixture("focus-board")
    await crashedApplicationCreate(drifted.application, drifted.runtimeRoot, "receipt_published")
    const driftedIntentRoot = path.join(drifted.runtimeRoot, "application-proposal-create-intents", "focus-board")
    const driftedIntent = JSON.parse(fs.readFileSync(path.join(
      driftedIntentRoot,
      fs.readdirSync(driftedIntentRoot).find((name) => /^[0-9a-f-]{36}\.json$/i.test(name))!,
    ), "utf8"))
    await rejectApplicationProposal({
      application: drifted.application,
      runtimeRoot: drifted.runtimeRoot,
      proposalId: driftedIntent.proposalId,
      requestedBy: "crash-owner",
      reason: "Legitimate terminal transition before tampering",
    })
    const receiptPath = path.join(drifted.runtimeRoot, "application-proposals", "focus-board", `${driftedIntent.proposalId}.json`)
    const tampered = JSON.parse(fs.readFileSync(receiptPath, "utf8"))
    tampered.requestedBy = "different-owner"
    fs.writeFileSync(receiptPath, `${JSON.stringify(tampered, null, 2)}\n`)

    await expect(reconcileApplicationProposalCreateIntents({
      application: drifted.application,
      runtimeRoot: drifted.runtimeRoot,
    })).rejects.toThrow("APPLICATION_PROPOSAL_CREATION_RECOVERY_UNCERTAIN")
    expect(fs.readdirSync(driftedIntentRoot).length).toBeGreaterThan(0)
  }, 30_000)

  it("accepts a valid manifest whose writable paths are normalized by the catalog", async () => {
    const { repositoryRoot, runtimeRoot } = await fixture("focus-board")
    const manifestPath = path.join(repositoryRoot, ".williamos/application.json")
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"))
    manifest.ai.writablePaths = [manifest.source.script, manifest.source.document, manifest.source.styles]
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
    git(repositoryRoot, "add", ".williamos/application.json")
    git(repositoryRoot, "commit", "-m", "reorder valid writable paths")
    const application = await readApplicationRepository(repositoryRoot, "focus-board")

    await expect(createApplicationProposal({
      application,
      runtimeRoot,
      requestedBy: "owner-1",
      requestText: "Change the theme",
      executionRoute: "cerebras-qwen-3-8-27b",
      externalRoutingEnabled: true,
      externalEgressApproved: true,
      cerebrasTurn: externalTurn({ "assets/theme.css": "main { color: teal; }\n" }),
      validateWorkspace: validation,
    })).resolves.toEqual(expect.objectContaining({ status: "READY_FOR_REVIEW" }))
  })

  it("refuses a local-model edit that would make the application disappear from the catalog", async () => {
    const { application, runtimeRoot } = await fixture("focus-board")
    await expect(createApplicationProposal({
      application,
      runtimeRoot,
      requestedBy: "owner-1",
      requestText: "Generate a very large page",
      executionRoute: "hermes-local",
      residentTurn: async ({ workspacePath }: { workspacePath: string }) => {
        fs.writeFileSync(path.join(workspacePath, "web/page.html"), "x".repeat(262_145))
        return {
          threadId: "local-thread",
          turnId: "local-turn",
          model: "williamos-qwen3-4b:64k",
          executionNode: "hermes-node",
          ignoredPathsCreated: [],
        }
      },
      validateWorkspace: validation,
    })).rejects.toThrow("APPLICATION_PROPOSAL_SOURCE_SIZE_REFUSED")
  })

  it("creates an application-bound v4 receipt and persists terminal rejection", async () => {
    const { application, runtimeRoot } = await fixture("focus-board")
    const proposal = await createApplicationProposal({
      application,
      runtimeRoot,
      requestedBy: "owner-1",
      requestText: "Add reset behavior",
      executionRoute: "cerebras-qwen-3-8-27b",
      externalRoutingEnabled: true,
      externalEgressApproved: true,
      cerebrasTurn: externalTurn({ "client/main.js": "document.body.dataset.reset = 'ready'\n" }),
      validateWorkspace: validation,
    })
    expect(proposal).toEqual(expect.objectContaining({
      schemaVersion: 4,
      status: "READY_FOR_REVIEW",
      applicationId: "focus-board",
      manifestDigest: application.manifestDigest,
      writablePaths: ["web/page.html", "assets/theme.css", "client/main.js"],
      changedPaths: ["client/main.js"],
      executionRoute: "cerebras-qwen-3-8-27b",
      executionProvider: "cerebras",
      executionNode: "cerebras-api",
      model: "qwen-3.8-27b",
      validation: { status: "passed", command: "node --test test/application.test.mjs", output: "ok" },
    }))
    expect(JSON.stringify(proposal)).not.toContain(application.repositoryRoot)
    expect(listApplicationProposals({ applicationId: "focus-board", runtimeRoot, requestedBy: "owner-1" })).toHaveLength(1)
    expect(() => getApplicationProposal({ applicationId: "notes-pad", runtimeRoot, proposalId: proposal.proposalId, requestedBy: "owner-1" })).toThrow("APPLICATION_PROPOSAL_NOT_FOUND")

    const rejected = await rejectApplicationProposal({ application, runtimeRoot, proposalId: proposal.proposalId, requestedBy: "owner-1", reason: "Discard this draft" })
    expect(rejected.status).toBe("REJECTED")
    expect(rejectApplicationProposal({ application, runtimeRoot, proposalId: proposal.proposalId, requestedBy: "owner-1", reason: "Discard this draft" })).resolves.toEqual(rejected)
    await expect(applyApplicationProposal({ application, runtimeRoot, proposalId: proposal.proposalId, requestedBy: "owner-1", validateWorkspace: validation })).rejects.toThrow("APPLICATION_PROPOSAL_NOT_APPLICABLE")
  })

  it("refuses a proposal-ref parent swap during terminal Reject cleanup and resumes exactly", async () => {
    const { application, repositoryRoot, runtimeRoot } = await fixture("focus-board")
    const proposal = await createApplicationProposal({
      application, runtimeRoot, requestedBy: "owner-1", requestText: "Change the theme",
      executionRoute: "cerebras-qwen-3-8-27b", externalRoutingEnabled: true, externalEgressApproved: true,
      cerebrasTurn: externalTurn({ "assets/theme.css": "main { color: teal; }\n" }), validateWorkspace: validation,
    })
    const branchParent = path.join(repositoryRoot, ".git", "refs", "heads", "codex")
    const escapedRefs = path.join(path.dirname(repositoryRoot), "escaped-terminal-refs")
    await expect(rejectApplicationProposal({
      application,
      runtimeRoot,
      proposalId: proposal.proposalId,
      requestedBy: "owner-1",
      reason: "Discard this draft",
      transactionOperations: {
        checkpoint(stage: string) {
          if (stage !== "terminal_published") return
          fs.renameSync(branchParent, escapedRefs)
          fs.symlinkSync(escapedRefs, branchParent, process.platform === "win32" ? "junction" : "dir")
        },
      },
    })).rejects.toThrow("APPLICATION_PROPOSAL_REPOSITORY_INVALID")
    expect(getApplicationProposal({
      applicationId: "focus-board", runtimeRoot, proposalId: proposal.proposalId, requestedBy: "owner-1",
    }).status).toBe("REJECTED")
    expect(fs.readdirSync(escapedRefs)).toContain(path.basename(proposal.branch))

    fs.rmdirSync(branchParent)
    fs.renameSync(escapedRefs, branchParent)
    await expect(rejectApplicationProposal({
      application, runtimeRoot, proposalId: proposal.proposalId, requestedBy: "owner-1", reason: "Discard this draft",
    })).resolves.toEqual(expect.objectContaining({ status: "REJECTED" }))
    expect(git(repositoryRoot, "branch", "--list", proposal.branch)).toBe("")
  })

  it("applies only the reviewed candidate with CAS and returns a bounded duplicate Apply", async () => {
    const { application, repositoryRoot, runtimeRoot } = await fixture("focus-board")
    const proposal = await createApplicationProposal({
      application, runtimeRoot, requestedBy: "owner-1", requestText: "Update all three files",
      executionRoute: "cerebras-qwen-3-8-27b", externalRoutingEnabled: true, externalEgressApproved: true,
      cerebrasTurn: externalTurn({
        "web/page.html": "<main><button>Reset</button></main>\n",
        "assets/theme.css": "button { color: teal; }\n",
        "client/main.js": "document.querySelector('button').onclick = () => {}\n",
      }),
      validateWorkspace: validation,
    })
    const applied = await applyApplicationProposal({
      application,
      runtimeRoot,
      proposalId: proposal.proposalId,
      requestedBy: "owner-1",
      validateWorkspace: validation,
    })
    expect(applied.status).toBe("APPLIED")
    expect(applied.appliedCommit).toBe(git(repositoryRoot, "rev-parse", "HEAD"))
    expect(fs.readFileSync(path.join(repositoryRoot, "web/page.html"), "utf8")).toContain("Reset")
    await expect(applyApplicationProposal({ application: await readApplicationRepository(repositoryRoot, "focus-board"), runtimeRoot, proposalId: proposal.proposalId, requestedBy: "owner-1", validateWorkspace: validation })).resolves.toEqual(applied)
    expect(git(repositoryRoot, "status", "--porcelain")).toBe("")
  }, 15_000)

  it("replays an immutable APPLIED receipt after a legitimate manifest evolution", async () => {
    const { application, repositoryRoot, runtimeRoot } = await fixture("focus-board")
    const proposal = await createApplicationProposal({
      application, runtimeRoot, requestedBy: "owner-1", requestText: "Change the theme",
      executionRoute: "cerebras-qwen-3-8-27b", externalRoutingEnabled: true, externalEgressApproved: true,
      cerebrasTurn: externalTurn({ "assets/theme.css": "main { color: teal; }\n" }), validateWorkspace: validation,
    })
    const applied = await applyApplicationProposal({
      application, runtimeRoot, proposalId: proposal.proposalId, requestedBy: "owner-1", validateWorkspace: validation,
    })
    const manifestPath = path.join(repositoryRoot, ".williamos", "application.json")
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"))
    manifest.displayName = "Focus Board Evolved"
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
    git(repositoryRoot, "add", ".williamos/application.json")
    git(repositoryRoot, "commit", "-m", "evolve application manifest")
    const evolved = await readApplicationRepository(repositoryRoot, "focus-board")

    await expect(applyApplicationProposal({
      application: evolved,
      runtimeRoot,
      proposalId: proposal.proposalId,
      requestedBy: "owner-1",
      validateWorkspace: validation,
    })).resolves.toEqual(expect.objectContaining({
      status: "APPLIED",
      candidateSha: applied.candidateSha,
      manifestDigest: proposal.manifestDigest,
    }))
  })

  it("retries exact candidate-branch cleanup after APPLIED publication", async () => {
    const { application, repositoryRoot, runtimeRoot } = await fixture("focus-board")
    const proposal = await createApplicationProposal({
      application, runtimeRoot, requestedBy: "owner-1", requestText: "Change the theme",
      executionRoute: "cerebras-qwen-3-8-27b", externalRoutingEnabled: true, externalEgressApproved: true,
      cerebrasTurn: externalTurn({ "assets/theme.css": "main { color: teal; }\n" }), validateWorkspace: validation,
    })
    const branchParent = path.join(repositoryRoot, ".git", "refs", "heads", "codex")
    const escapedRefs = path.join(path.dirname(repositoryRoot), "escaped-applied-refs")
    await expect(applyApplicationProposal({
      application,
      runtimeRoot,
      proposalId: proposal.proposalId,
      requestedBy: "owner-1",
      validateWorkspace: validation,
      transactionOperations: {
        checkpoint(stage: string) {
          if (stage !== "receipt_replace") return
          fs.renameSync(branchParent, escapedRefs)
          fs.symlinkSync(escapedRefs, branchParent, process.platform === "win32" ? "junction" : "dir")
        },
      },
    })).rejects.toThrow("APPLICATION_PROPOSAL_REPOSITORY_INVALID")
    expect(getApplicationProposal({
      applicationId: "focus-board", runtimeRoot, proposalId: proposal.proposalId, requestedBy: "owner-1",
    }).status).toBe("APPLIED")
    expect(fs.readdirSync(escapedRefs)).toContain(path.basename(proposal.branch))

    fs.rmdirSync(branchParent)
    fs.renameSync(escapedRefs, branchParent)
    await expect(applyApplicationProposal({
      application, runtimeRoot, proposalId: proposal.proposalId, requestedBy: "owner-1", validateWorkspace: validation,
    })).resolves.toEqual(expect.objectContaining({ status: "APPLIED" }))
    expect(git(repositoryRoot, "branch", "--list", proposal.branch)).toBe("")
  }, 15_000)

  it("preserves unrelated owner staged work while publishing the reviewed candidate", async () => {
    const { application, repositoryRoot, runtimeRoot } = await fixture("focus-board")
    const proposal = await createApplicationProposal({
      application, runtimeRoot, requestedBy: "owner-1", requestText: "Update the page",
      executionRoute: "cerebras-qwen-3-8-27b", externalRoutingEnabled: true, externalEgressApproved: true,
      cerebrasTurn: externalTurn({ "web/page.html": "<main>Reviewed</main>\n" }), validateWorkspace: validation,
    })
    fs.writeFileSync(path.join(repositoryRoot, "owner-notes.txt"), "owner staged work\n")
    git(repositoryRoot, "add", "owner-notes.txt")

    const applied = await applyApplicationProposal({
      application,
      runtimeRoot,
      proposalId: proposal.proposalId,
      requestedBy: "owner-1",
      validateWorkspace: validation,
    })
    expect(applied.status).toBe("APPLIED")
    expect(fs.readFileSync(path.join(repositoryRoot, "owner-notes.txt"), "utf8")).toBe("owner staged work\n")
    expect(git(repositoryRoot, "diff", "--cached", "--name-only")).toBe("owner-notes.txt")
    expect(git(repositoryRoot, "rev-parse", "HEAD")).toBe(proposal.candidateSha)
  })

  it("disables repository hooks for every host Git transaction", async () => {
    const focus = await fixture("focus-board")
    const hookDirectory = path.join(focus.repositoryRoot, ".git", "hooks")
    const checkoutMarker = path.join(path.dirname(focus.repositoryRoot), "post-checkout-ran")
    const checkoutHook = path.join(hookDirectory, "post-checkout")
    fs.writeFileSync(checkoutHook, `#!/bin/sh\nprintf ran > '${gitShellPath(checkoutMarker)}'\n`)
    fs.chmodSync(checkoutHook, 0o755)
    const proposal = await createApplicationProposal({
      application: focus.application,
      runtimeRoot: focus.runtimeRoot,
      requestedBy: "owner",
      requestText: "Update the theme",
      executionRoute: "cerebras-qwen-3-8-27b",
      externalRoutingEnabled: true,
      externalEgressApproved: true,
      cerebrasTurn: externalTurn({ "assets/theme.css": "main { color: teal; }\n" }),
      validateWorkspace: validation,
    })
    expect(fs.existsSync(checkoutMarker)).toBe(false)

    const referenceMarker = path.join(path.dirname(focus.repositoryRoot), "reference-transaction-ran")
    const referenceHook = path.join(hookDirectory, "reference-transaction")
    fs.writeFileSync(referenceHook, `#!/bin/sh\nprintf ran > '${gitShellPath(referenceMarker)}'\n`)
    fs.chmodSync(referenceHook, 0o755)
    await applyApplicationProposal({
      application: focus.application,
      runtimeRoot: focus.runtimeRoot,
      proposalId: proposal.proposalId,
      requestedBy: "owner",
      validateWorkspace: validation,
    })
    expect(fs.existsSync(referenceMarker)).toBe(false)
  })

  it.each(["turn", "validation"])(
    "refuses a forbidden repository configuration introduced during %s",
    async (mutationStage) => {
      const { application, repositoryRoot, runtimeRoot } = await fixture("focus-board")
      const turn = externalTurn({ "assets/theme.css": "main { color: teal; }\n" })
      await expect(createApplicationProposal({
        application,
        runtimeRoot,
        requestedBy: "owner-1",
        requestText: "Change the theme",
        executionRoute: "cerebras-qwen-3-8-27b",
        externalRoutingEnabled: true,
        externalEgressApproved: true,
        cerebrasTurn: async (input: any) => {
          const result = await turn(input)
          if (mutationStage === "turn") git(repositoryRoot, "config", "filter.injected.clean", "cat")
          return result
        },
        validateWorkspace: async () => {
          if (mutationStage === "validation") git(repositoryRoot, "config", "filter.injected.clean", "cat")
          return validation()
        },
      })).rejects.toThrow("APPLICATION_PROPOSAL_REPOSITORY_INVALID")
      expect(git(repositoryRoot, "worktree", "list", "--porcelain").match(/^worktree /gm)).toHaveLength(1)
    },
  )

  it("fails closed when repository configuration enumeration cannot complete", async () => {
    const { application, repositoryRoot, runtimeRoot } = await fixture("focus-board")
    fs.writeFileSync(path.join(repositoryRoot, ".git", "config"), "[invalid configuration\n")
    await expect(createApplicationProposal({
      application,
      runtimeRoot,
      requestedBy: "owner-1",
      requestText: "Change the theme",
      executionRoute: "cerebras-qwen-3-8-27b",
      externalRoutingEnabled: true,
      externalEgressApproved: true,
      cerebrasTurn: externalTurn({ "assets/theme.css": "main { color: teal; }\n" }),
      validateWorkspace: validation,
    })).rejects.toThrow("APPLICATION_PROPOSAL_REPOSITORY_INVALID")
  })

  it("refuses manifest, base, and stored-patch drift without touching the owner repository", async () => {
    const { application, repositoryRoot, runtimeRoot } = await fixture("focus-board")
    const make = () => createApplicationProposal({
      application, runtimeRoot, requestedBy: "owner-1", requestText: "Change the theme",
      executionRoute: "cerebras-qwen-3-8-27b", externalRoutingEnabled: true, externalEgressApproved: true,
      cerebrasTurn: externalTurn({ "assets/theme.css": "main { color: teal; }\n" }), validateWorkspace: validation,
    })
    const patchRace = await make()
    const patch = path.join(runtimeRoot, "application-proposals", "focus-board", `${patchRace.proposalId}.patch`)
    fs.appendFileSync(patch, "tampered")
    await expect(applyApplicationProposal({ application, runtimeRoot, proposalId: patchRace.proposalId, requestedBy: "owner-1", validateWorkspace: validation })).rejects.toThrow("APPLICATION_PROPOSAL_PATCH_MISMATCH")
    expect(git(repositoryRoot, "rev-parse", "HEAD")).toBe(application.head)

    fs.writeFileSync(path.join(repositoryRoot, "web/page.html"), "owner edit\n")
    const cleanPatch = path.join(runtimeRoot, "application-proposals", "focus-board", `${patchRace.proposalId}.patch`)
    fs.writeFileSync(cleanPatch, patchRace.reviewPatch)
    await expect(applyApplicationProposal({ application, runtimeRoot, proposalId: patchRace.proposalId, requestedBy: "owner-1", validateWorkspace: validation })).rejects.toThrow("APPLICATION_PROPOSAL_TARGET_DIRTY")
    expect(fs.readFileSync(path.join(repositoryRoot, "web/page.html"), "utf8")).toBe("owner edit\n")
  })

  it("re-reads the canonical manifest at Apply instead of trusting a stale catalog object", async () => {
    const { application, repositoryRoot, runtimeRoot } = await fixture("focus-board")
    const proposal = await createApplicationProposal({
      application, runtimeRoot, requestedBy: "owner-1", requestText: "Change the theme",
      executionRoute: "cerebras-qwen-3-8-27b", externalRoutingEnabled: true, externalEgressApproved: true,
      cerebrasTurn: externalTurn({ "assets/theme.css": "main { color: teal; }\n" }), validateWorkspace: validation,
    })
    const manifestPath = path.join(repositoryRoot, ".williamos/application.json")
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"))
    manifest.displayName = "Changed Behind The Catalog"
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)

    await expect(applyApplicationProposal({
      application,
      runtimeRoot,
      proposalId: proposal.proposalId,
      requestedBy: "owner-1",
      validateWorkspace: validation,
    })).rejects.toThrow("APPLICATION_PROPOSAL_MANIFEST_DRIFT")
    expect(git(repositoryRoot, "rev-parse", "HEAD")).toBe(application.head)
    expect(JSON.parse(fs.readFileSync(manifestPath, "utf8")).displayName).toBe("Changed Behind The Catalog")
  })

  it("uses one digest-bound patch snapshot when the durable review artifact races Apply", async () => {
    const { application, repositoryRoot, runtimeRoot } = await fixture("focus-board")
    const proposal = await createApplicationProposal({
      application, runtimeRoot, requestedBy: "owner-1", requestText: "Change the theme",
      executionRoute: "cerebras-qwen-3-8-27b", externalRoutingEnabled: true, externalEgressApproved: true,
      cerebrasTurn: externalTurn({ "assets/theme.css": "main { color: teal; }\n" }), validateWorkspace: validation,
    })
    const patchPath = path.join(runtimeRoot, "application-proposals", "focus-board", `${proposal.proposalId}.patch`)
    const realOpen = fs.openSync.bind(fs)
    const realRead = fs.readSync.bind(fs)
    let patchDescriptor: number | undefined
    let mutated = false
    const open = vi.spyOn(fs, "openSync").mockImplementation(((target: fs.PathLike, flags: fs.OpenMode, mode?: fs.Mode) => {
      const descriptor = realOpen(target, flags, mode)
      if (path.resolve(String(target)) === path.resolve(patchPath)) patchDescriptor = descriptor
      return descriptor
    }) as typeof fs.openSync)
    const read = vi.spyOn(fs, "readSync").mockImplementation(((descriptor: number, ...args: any[]) => {
      const result = (realRead as any)(descriptor, ...args)
      if (descriptor === patchDescriptor && !mutated) {
        mutated = true
        fs.appendFileSync(patchPath, "\n# concurrent artifact rewrite\n")
      }
      return result
    }) as typeof fs.readSync)
    try {
      await expect(applyApplicationProposal({
        application,
        runtimeRoot,
        proposalId: proposal.proposalId,
        requestedBy: "owner-1",
        validateWorkspace: validation,
      })).rejects.toThrow("APPLICATION_PROPOSAL_PATCH_MISMATCH")
    } finally { read.mockRestore(); open.mockRestore() }
    expect(git(repositoryRoot, "rev-parse", "HEAD")).toBe(application.head)
  })

  it("refuses a fresh catalog context after the repository base advances", async () => {
    const { application, repositoryRoot, runtimeRoot } = await fixture("focus-board")
    const proposal = await createApplicationProposal({
      application, runtimeRoot, requestedBy: "owner-1", requestText: "Change the theme",
      executionRoute: "cerebras-qwen-3-8-27b", externalRoutingEnabled: true, externalEgressApproved: true,
      cerebrasTurn: externalTurn({ "assets/theme.css": "main { color: teal; }\n" }), validateWorkspace: validation,
    })
    fs.writeFileSync(path.join(repositoryRoot, "owner-notes.txt"), "new owner commit\n")
    git(repositoryRoot, "add", "owner-notes.txt")
    git(repositoryRoot, "commit", "-m", "owner base advance")
    const advanced = await readApplicationRepository(repositoryRoot, "focus-board")

    await expect(applyApplicationProposal({
      application: advanced,
      runtimeRoot,
      proposalId: proposal.proposalId,
      requestedBy: "owner-1",
      validateWorkspace: validation,
    })).rejects.toThrow("APPLICATION_PROPOSAL_STALE_BASE")
    expect(fs.readFileSync(path.join(repositoryRoot, "assets/theme.css"), "utf8")).toBe("main { color: navy; }\n")
    expect(git(repositoryRoot, "rev-parse", "HEAD")).toBe(advanced.head)
  })

  it("keeps same-request Create retries as distinct reviewable proposals", async () => {
    const { application, runtimeRoot } = await fixture("focus-board")
    const create = () => createApplicationProposal({
      application, runtimeRoot, requestedBy: "owner-1", requestText: "Change the theme",
      executionRoute: "cerebras-qwen-3-8-27b", externalRoutingEnabled: true, externalEgressApproved: true,
      cerebrasTurn: externalTurn({ "assets/theme.css": "main { color: teal; }\n" }), validateWorkspace: validation,
    })
    const first = await create()
    const second = await create()
    expect(second.proposalId).not.toBe(first.proposalId)
    expect(second.branch).not.toBe(first.branch)
    expect(listApplicationProposals({ applicationId: "focus-board", runtimeRoot, requestedBy: "owner-1" }))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ proposalId: first.proposalId, status: "READY_FOR_REVIEW" }),
        expect.objectContaining({ proposalId: second.proposalId, status: "READY_FOR_REVIEW" }),
      ]))
  })

  it("removes an owned patch artifact when Create receipt publication fails", async () => {
    const { application, runtimeRoot } = await fixture("focus-board")
    const realRename = fs.renameSync.bind(fs)
    const rename = vi.spyOn(fs, "renameSync").mockImplementation(((source: fs.PathLike, destination: fs.PathLike) => {
      if (String(destination).includes(`${path.sep}application-proposals${path.sep}focus-board${path.sep}`)
        && String(destination).endsWith(".json")) throw new Error("simulated receipt publication failure")
      return realRename(source, destination)
    }) as typeof fs.renameSync)
    try {
      await expect(createApplicationProposal({
        application, runtimeRoot, requestedBy: "owner-1", requestText: "Change the theme",
        executionRoute: "cerebras-qwen-3-8-27b", externalRoutingEnabled: true, externalEgressApproved: true,
        cerebrasTurn: externalTurn({ "assets/theme.css": "main { color: teal; }\n" }), validateWorkspace: validation,
      })).rejects.toThrow("simulated receipt publication failure")
    } finally { rename.mockRestore() }
    const directory = path.join(runtimeRoot, "application-proposals", "focus-board")
    expect(fs.existsSync(directory) ? fs.readdirSync(directory) : []).toEqual([])
  })

  it("lists a marker-only Create quarantine when primary receipt publication and cleanup fail", async () => {
    const { application, runtimeRoot } = await fixture("focus-board")
    const realRename = fs.renameSync.bind(fs)
    const realUnlink = fs.unlinkSync.bind(fs)
    const primaryReceipt = new RegExp(`${path.sep === "\\" ? "\\\\" : path.sep}[0-9a-f-]{36}\\.json$`, "i")
    const rename = vi.spyOn(fs, "renameSync").mockImplementation(((source: fs.PathLike, destination: fs.PathLike) => {
      if (primaryReceipt.test(String(destination))) throw new Error("simulated primary receipt publication failure")
      return realRename(source, destination)
    }) as typeof fs.renameSync)
    const unlink = vi.spyOn(fs, "unlinkSync").mockImplementation(((target: fs.PathLike) => {
      if (String(target).endsWith(".patch")) throw new Error("simulated patch cleanup failure")
      return realUnlink(target)
    }) as typeof fs.unlinkSync)
    try {
      await expect(createApplicationProposal({
        application, runtimeRoot, requestedBy: "owner-1", requestText: "Change the theme",
        executionRoute: "cerebras-qwen-3-8-27b", externalRoutingEnabled: true, externalEgressApproved: true,
        cerebrasTurn: externalTurn({ "assets/theme.css": "main { color: teal; }\n" }), validateWorkspace: validation,
      })).rejects.toThrow("APPLICATION_PROPOSAL_ARTIFACT_CLEANUP_FAILED")
    } finally { unlink.mockRestore(); rename.mockRestore() }

    const listed = listApplicationProposals({ applicationId: "focus-board", runtimeRoot, requestedBy: "owner-1" })
    expect(listed).toHaveLength(1)
    expect(listed[0]).toEqual(expect.objectContaining({
      status: "QUARANTINED_ROLLBACK_FAILED",
      quarantineReason: "APPLICATION_PROPOSAL_ARTIFACT_CLEANUP_FAILED",
    }))
  })

  it("refuses linked proposal-storage and repository-lock descendants", async () => {
    const proposalStorage = await fixture("focus-board")
    const escapedStorage = path.join(path.dirname(proposalStorage.runtimeRoot), "escaped-proposal-storage")
    fs.mkdirSync(escapedStorage)
    fs.mkdirSync(proposalStorage.runtimeRoot)
    fs.symlinkSync(
      escapedStorage,
      path.join(proposalStorage.runtimeRoot, "application-proposals"),
      process.platform === "win32" ? "junction" : "dir",
    )

    await expect(createApplicationProposal({
      application: proposalStorage.application,
      runtimeRoot: proposalStorage.runtimeRoot,
      requestedBy: "owner-1",
      requestText: "Change the theme",
      executionRoute: "cerebras-qwen-3-8-27b",
      externalRoutingEnabled: true,
      externalEgressApproved: true,
      cerebrasTurn: externalTurn({ "assets/theme.css": "main { color: teal; }\n" }),
      validateWorkspace: validation,
    })).rejects.toThrow("APPLICATION_RUNTIME_ROOT_INVALID")
    expect(fs.readdirSync(escapedStorage)).toEqual([])
    expect(git(proposalStorage.repositoryRoot, "worktree", "list", "--porcelain").match(/^worktree /gm)).toHaveLength(1)
    expect(git(proposalStorage.repositoryRoot, "branch", "--list", "codex/williamos-app-*")).toBe("")

    const lockStorage = await fixture("notes-pad")
    const proposal = await createApplicationProposal({
      application: lockStorage.application,
      runtimeRoot: lockStorage.runtimeRoot,
      requestedBy: "owner-1",
      requestText: "Change the theme",
      executionRoute: "cerebras-qwen-3-8-27b",
      externalRoutingEnabled: true,
      externalEgressApproved: true,
      cerebrasTurn: externalTurn({ "assets/theme.css": "main { color: teal; }\n" }),
      validateWorkspace: validation,
    })
    const escapedLocks = path.join(path.dirname(lockStorage.runtimeRoot), "escaped-repository-locks")
    fs.mkdirSync(escapedLocks)
    const lockDirectory = path.join(lockStorage.runtimeRoot, "application-proposal-locks")
    expect(fs.readdirSync(lockDirectory)).toEqual([])
    fs.rmdirSync(lockDirectory)
    fs.symlinkSync(
      escapedLocks,
      lockDirectory,
      process.platform === "win32" ? "junction" : "dir",
    )
    await expect(rejectApplicationProposal({
      application: lockStorage.application,
      runtimeRoot: lockStorage.runtimeRoot,
      proposalId: proposal.proposalId,
      requestedBy: "owner-1",
      reason: "Discard this draft",
    })).rejects.toThrow("APPLICATION_RUNTIME_ROOT_INVALID")
    expect(fs.readdirSync(escapedLocks)).toEqual([])
  })

  it("refuses a linked worktrees descendant before Create or Apply can populate it", async () => {
    const createFixture = await fixture("focus-board")
    const escapedCreate = path.join(path.dirname(createFixture.runtimeRoot), "escaped-create-worktrees")
    fs.mkdirSync(escapedCreate)
    fs.mkdirSync(createFixture.runtimeRoot)
    fs.symlinkSync(
      escapedCreate,
      path.join(createFixture.runtimeRoot, "worktrees"),
      process.platform === "win32" ? "junction" : "dir",
    )
    await expect(createApplicationProposal({
      application: createFixture.application,
      runtimeRoot: createFixture.runtimeRoot,
      requestedBy: "owner",
      requestText: "Update the theme",
      executionRoute: "cerebras-qwen-3-8-27b",
      externalRoutingEnabled: true,
      externalEgressApproved: true,
      cerebrasTurn: externalTurn({ "assets/theme.css": "main { color: teal; }\n" }),
      validateWorkspace: validation,
    })).rejects.toThrow("APPLICATION_RUNTIME_ROOT_INVALID")
    expect(fs.readdirSync(escapedCreate)).toEqual([])
    expect(git(createFixture.repositoryRoot, "worktree", "list", "--porcelain").match(/^worktree /gm)).toHaveLength(1)

    const applyFixture = await fixture("notes-pad")
    const proposal = await createApplicationProposal({
      application: applyFixture.application,
      runtimeRoot: applyFixture.runtimeRoot,
      requestedBy: "owner",
      requestText: "Update the theme",
      executionRoute: "cerebras-qwen-3-8-27b",
      externalRoutingEnabled: true,
      externalEgressApproved: true,
      cerebrasTurn: externalTurn({ "assets/theme.css": "main { color: teal; }\n" }),
      validateWorkspace: validation,
    })
    const worktrees = path.join(applyFixture.runtimeRoot, "worktrees")
    fs.rmSync(worktrees, { recursive: true })
    const escapedApply = path.join(path.dirname(applyFixture.runtimeRoot), "escaped-apply-worktrees")
    fs.mkdirSync(escapedApply)
    fs.symlinkSync(escapedApply, worktrees, process.platform === "win32" ? "junction" : "dir")
    await expect(applyApplicationProposal({
      application: applyFixture.application,
      runtimeRoot: applyFixture.runtimeRoot,
      proposalId: proposal.proposalId,
      requestedBy: "owner",
      validateWorkspace: validation,
    })).rejects.toThrow("APPLICATION_RUNTIME_ROOT_INVALID")
    expect(fs.readdirSync(escapedApply)).toEqual([])
    expect(git(applyFixture.repositoryRoot, "rev-parse", "HEAD")).toBe(proposal.baseSha)
    expect(getApplicationProposal({
      applicationId: "notes-pad",
      runtimeRoot: applyFixture.runtimeRoot,
      proposalId: proposal.proposalId,
      requestedBy: "owner",
    }).status).toBe("READY_FOR_REVIEW")
  })

  it("refuses a preplaced candidate-index hardlink before Git can mutate an external file", async () => {
    const focus = await fixture("focus-board")
    const externalIndex = path.join(path.dirname(focus.runtimeRoot), "external-index-sentinel")
    fs.writeFileSync(externalIndex, "")
    let plantedIndex = ""

    await expect(createApplicationProposal({
      application: focus.application,
      runtimeRoot: focus.runtimeRoot,
      requestedBy: "owner",
      requestText: "Do not follow a planted candidate index",
      executionRoute: "hermes-local",
      residentTurn: async ({ workspacePath }: { workspacePath: string }) => {
        fs.writeFileSync(path.join(workspacePath, "web/page.html"), "<main>Index guarded</main>\n")
        return {
          threadId: "local-thread", turnId: "local-turn", model: "williamos-qwen3-4b:64k",
          executionNode: "hermes-node", ignoredPathsCreated: [],
        }
      },
      validateWorkspace: validation,
      transactionOperations: {
        checkpoint(stage: string, state: { workspace?: string }) {
          if (stage !== "intent_published") return
          const intentRoot = path.join(focus.runtimeRoot, "application-proposal-create-intents", "focus-board")
          const baseName = fs.readdirSync(intentRoot).find((name) => /^[0-9a-f-]{36}\.json$/i.test(name))!
          const intent = JSON.parse(fs.readFileSync(path.join(intentRoot, baseName), "utf8"))
          plantedIndex = `${state.workspace}.candidate-index-${intent.intentToken}`
          fs.linkSync(externalIndex, plantedIndex)
        },
      },
    })).rejects.toThrow("APPLICATION_PROPOSAL_WORKTREE_INVALID")

    expect(fs.readFileSync(externalIndex, "utf8")).toBe("")
    expect(plantedIndex).not.toBe("")
    expect(fs.existsSync(plantedIndex)).toBe(false)
  })

  it("removes an owned candidate-index lock sidecar after an interrupted Create", async () => {
    const focus = await fixture("focus-board")
    let sidecar = ""

    await expect(createApplicationProposal({
      application: focus.application,
      runtimeRoot: focus.runtimeRoot,
      requestedBy: "owner",
      requestText: "Clean an interrupted candidate index",
      executionRoute: "hermes-local",
      residentTurn: async ({ workspacePath }: { workspacePath: string }) => {
        fs.writeFileSync(path.join(workspacePath, "web/page.html"), "<main>Index cleanup</main>\n")
        return {
          threadId: "local-thread", turnId: "local-turn", model: "williamos-qwen3-4b:64k",
          executionNode: "hermes-node", ignoredPathsCreated: [],
        }
      },
      validateWorkspace: validation,
      transactionOperations: {
        checkpoint(stage: string, state: { candidateIndex?: string }) {
          if (stage !== "candidate_index_prepared") return
          sidecar = `${state.candidateIndex}.lock`
          fs.writeFileSync(sidecar, "owned interrupted Git lock\n")
          throw new Error("simulated candidate-index interruption")
        },
      },
    })).rejects.toThrow("simulated candidate-index interruption")

    expect(sidecar).not.toBe("")
    expect(fs.existsSync(sidecar)).toBe(false)
  })

  it("never unlinks a candidate-index lock sidecar hardlinked outside the runtime", async () => {
    const focus = await fixture("focus-board")
    const external = path.join(path.dirname(focus.runtimeRoot), "external-index-lock-sentinel")
    fs.writeFileSync(external, "external sentinel\n")
    let sidecar = ""

    await expect(createApplicationProposal({
      application: focus.application,
      runtimeRoot: focus.runtimeRoot,
      requestedBy: "owner",
      requestText: "Refuse an externally linked candidate lock",
      executionRoute: "hermes-local",
      residentTurn: async ({ workspacePath }: { workspacePath: string }) => {
        fs.writeFileSync(path.join(workspacePath, "web/page.html"), "<main>Index lock guarded</main>\n")
        return {
          threadId: "local-thread", turnId: "local-turn", model: "williamos-qwen3-4b:64k",
          executionNode: "hermes-node", ignoredPathsCreated: [],
        }
      },
      validateWorkspace: validation,
      transactionOperations: {
        checkpoint(stage: string, state: { candidateIndex?: string }) {
          if (stage !== "candidate_index_prepared") return
          sidecar = `${state.candidateIndex}.lock`
          fs.linkSync(external, sidecar)
          throw new Error("simulated linked candidate-index interruption")
        },
      },
    })).rejects.toThrow("APPLICATION_PROPOSAL_ARTIFACT_CLEANUP_FAILED")

    expect(sidecar).not.toBe("")
    expect(fs.readFileSync(external, "utf8")).toBe("external sentinel\n")
    expect(fs.existsSync(sidecar)).toBe(true)
    expect(fs.lstatSync(sidecar, { bigint: true }).nlink).toBe(2n)
    fs.unlinkSync(sidecar)
  })

  it("refuses a linked proposal-ref parent before Git can write outside the repository", async () => {
    const focus = await fixture("focus-board")
    const escapedRefs = path.join(path.dirname(focus.repositoryRoot), "escaped-proposal-refs")
    fs.mkdirSync(escapedRefs)
    fs.symlinkSync(
      escapedRefs,
      path.join(focus.repositoryRoot, ".git", "refs", "heads", "codex"),
      process.platform === "win32" ? "junction" : "dir",
    )

    await expect(createApplicationProposal({
      application: focus.application,
      runtimeRoot: focus.runtimeRoot,
      requestedBy: "owner",
      requestText: "Update the theme",
      executionRoute: "cerebras-qwen-3-8-27b",
      externalRoutingEnabled: true,
      externalEgressApproved: true,
      cerebrasTurn: externalTurn({ "assets/theme.css": "main { color: teal; }\n" }),
      validateWorkspace: validation,
    })).rejects.toThrow("APPLICATION_PROPOSAL_REPOSITORY_INVALID")
    expect(fs.readdirSync(escapedRefs)).toEqual([])
  })

  it("isolates two repositories and accepts one-, two-, and three-file subsets", async () => {
    const focus = await fixture("focus-board")
    const notes = await fixture("notes-pad")
    const focusProposal = await createApplicationProposal({
      application: focus.application, runtimeRoot: focus.runtimeRoot, requestedBy: "owner", requestText: "One file",
      executionRoute: "cerebras-qwen-3-8-27b", externalRoutingEnabled: true, externalEgressApproved: true,
      cerebrasTurn: externalTurn({ "web/page.html": "<main>Focus</main>\n" }), validateWorkspace: validation,
    })
    const notesProposal = await createApplicationProposal({
      application: notes.application, runtimeRoot: notes.runtimeRoot, requestedBy: "owner", requestText: "Two files",
      executionRoute: "cerebras-qwen-3-8-27b", externalRoutingEnabled: true, externalEgressApproved: true,
      cerebrasTurn: externalTurn({ "assets/theme.css": "body { color: green; }\n", "client/main.js": "document.title = 'Notes'\n" }), validateWorkspace: validation,
    })
    expect(focusProposal.changedPaths).toEqual(["web/page.html"])
    expect(notesProposal.changedPaths).toEqual(["assets/theme.css", "client/main.js"])
    expect(fs.existsSync(path.join(focus.runtimeRoot, "application-proposals", "notes-pad"))).toBe(false)
    expect(fs.existsSync(path.join(notes.runtimeRoot, "application-proposals", "focus-board"))).toBe(false)
  })

  it("serializes Apply per repository across processes while allowing another repository to proceed", async () => {
    const focus = await fixture("focus-board")
    const notes = await fixture("notes-pad")
    const commonRuntime = focus.runtimeRoot
    const create = (entry: typeof focus, content: string) => createApplicationProposal({
      application: entry.application,
      runtimeRoot: commonRuntime,
      requestedBy: "owner",
      requestText: "Update the page",
      executionRoute: "cerebras-qwen-3-8-27b",
      externalRoutingEnabled: true,
      externalEgressApproved: true,
      cerebrasTurn: externalTurn({ "web/page.html": content }),
      validateWorkspace: validation,
    })
    const focusProposal = await create(focus, "<main>Focus locked</main>\n")
    const notesProposal = await create(notes, "<main>Notes free</main>\n")
    const held = await abandonedRepositoryLock(commonRuntime, focus.repositoryRoot, focusProposal.proposalId, true)
    try {
      await expect(applyApplicationProposal({
        application: focus.application,
        runtimeRoot: commonRuntime,
        proposalId: focusProposal.proposalId,
        requestedBy: "owner",
        validateWorkspace: validation,
      })).rejects.toThrow("APPLICATION_PROPOSAL_REPOSITORY_BUSY")
      await expect(applyApplicationProposal({
        application: notes.application,
        runtimeRoot: commonRuntime,
        proposalId: notesProposal.proposalId,
        requestedBy: "owner",
        validateWorkspace: validation,
      })).resolves.toEqual(expect.objectContaining({ status: "APPLIED" }))
    } finally {
      held.child.kill()
      await once(held.child, "close")
    }
    await expect(applyApplicationProposal({
      application: focus.application,
      runtimeRoot: commonRuntime,
      proposalId: focusProposal.proposalId,
      requestedBy: "owner",
      validateWorkspace: validation,
    })).resolves.toEqual(expect.objectContaining({ status: "APPLIED" }))
  }, 30_000)

  it("serializes a high-contention recovery section across independent processes", async () => {
    const focus = await fixture("focus-board")
    const moduleUrl = pathToFileURL(path.join(process.cwd(), "lib/applications/proposal-repository-lock.mjs")).href
    const guardPath = path.join(path.dirname(focus.runtimeRoot), "recovery-critical-section.guard")
    const logPath = path.join(path.dirname(focus.runtimeRoot), "recovery-critical-section.log")
    const contenders = Array.from({ length: 4 }, (_unused, index) => {
      const script = `
        import fs from "node:fs";
        import { withApplicationRepositoryRecoveryClaim } from ${JSON.stringify(moduleUrl)};
        await withApplicationRepositoryRecoveryClaim({
          runtimeRoot: ${JSON.stringify(focus.runtimeRoot)},
          repositoryRoot: ${JSON.stringify(focus.repositoryRoot)},
          waitMs: 15000,
          action: async () => {
            let descriptor;
            try { descriptor = fs.openSync(${JSON.stringify(guardPath)}, "wx"); }
            catch { throw new Error("RECOVERY_SECTION_OVERLAP"); }
            try {
              fs.appendFileSync(${JSON.stringify(logPath)}, ${JSON.stringify(`${index}\n`)});
              await new Promise((resolve) => setTimeout(resolve, 75));
            } finally {
              fs.closeSync(descriptor);
              fs.unlinkSync(${JSON.stringify(guardPath)});
            }
          },
        });
      `
      return spawn(process.execPath, ["--input-type=module", "-e", script], {
        stdio: ["ignore", "ignore", "pipe"],
        windowsHide: true,
      })
    })
    const results = await Promise.all(contenders.map(async (child) => {
      let stderr = ""
      child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8") })
      const [code] = await once(child, "close") as [number]
      return { code, stderr }
    }))
    expect(results).toEqual(results.map(() => ({ code: 0, stderr: "" })))
    expect(fs.readFileSync(logPath, "utf8").trim().split(/\r?\n/)).toHaveLength(4)
    expect(fs.existsSync(guardPath)).toBe(false)
  }, 20_000)

  it("recovers a dead repository lock after a terminal Reject receipt was published", async () => {
    const focus = await fixture("focus-board")
    const create = (content: string) => createApplicationProposal({
      application: focus.application,
      runtimeRoot: focus.runtimeRoot,
      requestedBy: "owner",
      requestText: "Update the page",
      executionRoute: "cerebras-qwen-3-8-27b",
      externalRoutingEnabled: true,
      externalEgressApproved: true,
      cerebrasTurn: externalTurn({ "web/page.html": content }),
      validateWorkspace: validation,
    })
    const first = await create("<main>First</main>\n")
    const second = await create("<main>Second</main>\n")
    await abandonedRepositoryLock(focus.runtimeRoot, focus.repositoryRoot, first.proposalId)
    const firstReceiptPath = path.join(focus.runtimeRoot, "application-proposals", "focus-board", `${first.proposalId}.json`)
    const firstReceipt = JSON.parse(fs.readFileSync(firstReceiptPath, "utf8"))
    fs.writeFileSync(firstReceiptPath, `${JSON.stringify({
      ...firstReceipt,
      status: "REJECTED",
      rejectedAt: new Date().toISOString(),
      rejectionReason: "Discard this draft",
    }, null, 2)}\n`)

    await expect(rejectApplicationProposal({
      application: focus.application,
      runtimeRoot: focus.runtimeRoot,
      proposalId: second.proposalId,
      requestedBy: "owner",
      reason: "Discard this draft",
    })).resolves.toEqual(expect.objectContaining({ status: "REJECTED" }))
  }, 15_000)

  it("reaps a crashed recovery claimant and ignores atomic-write temporaries", async () => {
    const focus = await fixture("focus-board")
    const proposal = await createApplicationProposal({
      application: focus.application,
      runtimeRoot: focus.runtimeRoot,
      requestedBy: "owner",
      requestText: "Update the page",
      executionRoute: "cerebras-qwen-3-8-27b",
      externalRoutingEnabled: true,
      externalEgressApproved: true,
      cerebrasTurn: externalTurn({ "web/page.html": "<main>Candidate</main>\n" }),
      validateWorkspace: validation,
    })
    await abandonedRepositoryRecoveryClaim(focus.runtimeRoot, focus.repositoryRoot)
    const lockDirectory = path.join(focus.runtimeRoot, "application-proposal-locks")
    fs.writeFileSync(path.join(lockDirectory, ".reaper-write-concurrent.tmp"), "partial private write")
    await expect(rejectApplicationProposal({
      application: focus.application,
      runtimeRoot: focus.runtimeRoot,
      proposalId: proposal.proposalId,
      requestedBy: "owner",
      reason: "Discard this draft",
    })).resolves.toEqual(expect.objectContaining({ status: "REJECTED" }))
  }, 15_000)

  it.each(["recovery_claim_linked", "repository_lock_linked"] as const)(
    "recovers a hard-killed %s publication with a retained private hardlink",
    async (crashStage) => {
      const focus = await fixture("focus-board")
      await crashedRepositoryLockPublication(focus.runtimeRoot, focus.repositoryRoot, crashStage)
      const lockDirectory = path.join(focus.runtimeRoot, "application-proposal-locks")
      expect(fs.readdirSync(lockDirectory).some((name) => name.endsWith(".write"))).toBe(true)

      if (crashStage === "recovery_claim_linked") {
        await expect(withApplicationRepositoryRecoveryClaim({
          runtimeRoot: focus.runtimeRoot,
          repositoryRoot: focus.repositoryRoot,
          action: async () => "recovered",
        })).resolves.toBe("recovered")
      } else {
        const recoverStale = vi.fn(async () => {})
        const claim = await acquireApplicationRepositoryLock({
          runtimeRoot: focus.runtimeRoot,
          repositoryRoot: focus.repositoryRoot,
          proposalId: "22222222-2222-4222-8222-222222222222",
          recoverStale,
        })
        expect(recoverStale).toHaveBeenCalledWith(expect.objectContaining({
          proposalId: "11111111-1111-4111-8111-111111111111",
        }))
        releaseApplicationRepositoryLock(claim)
      }

      expect(fs.readdirSync(lockDirectory).filter((name) => name.endsWith(".write"))).toEqual([])
    },
    20_000,
  )

  it("never publishes a partial recovery claim when its private write fails", async () => {
    const focus = await fixture("focus-board")
    const realWrite = fs.writeFileSync.bind(fs)
    let failed = false
    const write = vi.spyOn(fs, "writeFileSync").mockImplementation(((target: fs.PathOrFileDescriptor, content: any, options?: any) => {
      if (!failed && typeof target === "number" && String(content).includes('"ticket"')) {
        failed = true
        throw new Error("simulated recovery-claim write failure")
      }
      return realWrite(target, content, options)
    }) as typeof fs.writeFileSync)
    try {
      await expect(withApplicationRepositoryRecoveryClaim({
        runtimeRoot: focus.runtimeRoot,
        repositoryRoot: focus.repositoryRoot,
        action: async () => "unreachable",
      })).rejects.toThrow("simulated recovery-claim write failure")
    } finally { write.mockRestore() }
    const directory = path.join(focus.runtimeRoot, "application-proposal-locks")
    expect(fs.readdirSync(directory).filter((name) => name.includes(".reap-"))).toEqual([])
    await expect(withApplicationRepositoryRecoveryClaim({
      runtimeRoot: focus.runtimeRoot,
      repositoryRoot: focus.repositoryRoot,
      action: async () => "recovered",
    })).resolves.toBe("recovered")
  })

  it.each(["READY_FOR_REVIEW", "APPLY_IN_PROGRESS"])(
    "does not reinterpret stale %s recovery under a different manifest binding",
    async (status) => {
      const focus = await fixture("focus-board")
      const proposal = await createApplicationProposal({
        application: focus.application,
        runtimeRoot: focus.runtimeRoot,
        requestedBy: "owner",
        requestText: "Update the theme",
        executionRoute: "cerebras-qwen-3-8-27b",
        externalRoutingEnabled: true,
        externalEgressApproved: true,
        cerebrasTurn: externalTurn({ "assets/theme.css": "main { color: teal; }\n" }),
        validateWorkspace: validation,
      })
      const abandoned = await abandonedRepositoryLock(focus.runtimeRoot, focus.repositoryRoot, proposal.proposalId)
      const receiptPath = path.join(focus.runtimeRoot, "application-proposals", "focus-board", `${proposal.proposalId}.json`)
      const value = JSON.parse(fs.readFileSync(receiptPath, "utf8"))
      fs.writeFileSync(receiptPath, `${JSON.stringify({
        ...value,
        manifestDigest: "f".repeat(64),
        ...(status === "APPLY_IN_PROGRESS" ? {
          status,
          applyStartedAt: new Date().toISOString(),
          applyToken: abandoned.claim.token,
          applyProcessId: abandoned.claim.processId,
        } : {}),
      }, null, 2)}\n`)
      const target = await createApplicationProposal({
        application: focus.application,
        runtimeRoot: focus.runtimeRoot,
        requestedBy: "owner",
        requestText: "Update the page",
        executionRoute: "cerebras-qwen-3-8-27b",
        externalRoutingEnabled: true,
        externalEgressApproved: true,
        cerebrasTurn: externalTurn({ "web/page.html": "<main>Second candidate</main>\n" }),
        validateWorkspace: validation,
      })

      await expect(applyApplicationProposal({
        application: focus.application,
        runtimeRoot: focus.runtimeRoot,
        proposalId: target.proposalId,
        requestedBy: "owner",
        validateWorkspace: validation,
      })).rejects.toThrow(status === "APPLY_IN_PROGRESS"
        ? "APPLICATION_PROPOSAL_QUARANTINED"
        : "APPLICATION_PROPOSAL_LOCK_UNCERTAIN")
      expect(getApplicationProposal({
        applicationId: "focus-board",
        runtimeRoot: focus.runtimeRoot,
        proposalId: proposal.proposalId,
        requestedBy: "owner",
      }).status).toBe(status === "APPLY_IN_PROGRESS" ? "QUARANTINED_ROLLBACK_FAILED" : "READY_FOR_REVIEW")
      expect(git(focus.repositoryRoot, "rev-parse", "HEAD")).toBe(proposal.baseSha)
    },
    15_000,
  )

  it("never publishes a partial repository lock when its private write fails", async () => {
    const focus = await fixture("focus-board")
    const proposalId = "11111111-1111-4111-8111-111111111111"
    const realWrite = fs.writeFileSync.bind(fs)
    let failed = false
    const write = vi.spyOn(fs, "writeFileSync").mockImplementation(((target: fs.PathOrFileDescriptor, content: any, options?: any) => {
      if (!failed && typeof target === "number" && String(content).includes('"proposalId"')) {
        failed = true
        throw new Error("simulated repository-lock write failure")
      }
      return realWrite(target, content, options)
    }) as typeof fs.writeFileSync)
    try {
      await expect(acquireApplicationRepositoryLock({
        runtimeRoot: focus.runtimeRoot,
        repositoryRoot: focus.repositoryRoot,
        proposalId,
        recoverStale: async () => { throw new Error("unexpected stale recovery") },
      })).rejects.toThrow("simulated repository-lock write failure")
    } finally { write.mockRestore() }
    expect(fs.existsSync(applicationRepositoryLockPath(focus.runtimeRoot, focus.repositoryRoot))).toBe(false)
    const claim = await acquireApplicationRepositoryLock({
      runtimeRoot: focus.runtimeRoot,
      repositoryRoot: focus.repositoryRoot,
      proposalId,
      recoverStale: async () => { throw new Error("unexpected stale recovery") },
    })
    releaseApplicationRepositoryLock(claim)
  })

  it("reaps a same-process recovery claim left by persistent release failure", async () => {
    const focus = await fixture("focus-board")
    const realRename = fs.renameSync.bind(fs)
    const rename = vi.spyOn(fs, "renameSync").mockImplementation(((source: fs.PathLike, destination: fs.PathLike) => {
      if (/\.reap-[0-9a-f-]+\.json$/i.test(String(source)) && String(destination).endsWith(".release")) {
        const error = Object.assign(new Error("simulated recovery-claim release failure"), { code: "EPERM" })
        throw error
      }
      return realRename(source, destination)
    }) as typeof fs.renameSync)
    try {
      await expect(withApplicationRepositoryRecoveryClaim({
        runtimeRoot: focus.runtimeRoot,
        repositoryRoot: focus.repositoryRoot,
        action: async () => "completed action",
      })).rejects.toThrow("APPLICATION_PROPOSAL_LOCK_UNCERTAIN")
    } finally { rename.mockRestore() }
    await expect(withApplicationRepositoryRecoveryClaim({
      runtimeRoot: focus.runtimeRoot,
      repositoryRoot: focus.repositoryRoot,
      action: async () => "next action",
    })).resolves.toBe("next action")
  })

  it("unwinds a repository lock when the enclosing recovery claim cannot be released", async () => {
    const focus = await fixture("focus-board")
    const proposalId = "11111111-1111-4111-8111-111111111111"
    const lockPath = applicationRepositoryLockPath(focus.runtimeRoot, focus.repositoryRoot)
    const realRename = fs.renameSync.bind(fs)
    const rename = vi.spyOn(fs, "renameSync").mockImplementation(((source: fs.PathLike, destination: fs.PathLike) => {
      if (/\.reap-[0-9a-f-]+\.json$/i.test(String(source)) && String(destination).endsWith(".release")) {
        throw Object.assign(new Error("simulated recovery-claim unlink failure"), { code: "EPERM" })
      }
      return realRename(source, destination)
    }) as typeof fs.renameSync)
    try {
      await expect(acquireApplicationRepositoryLock({
        runtimeRoot: focus.runtimeRoot,
        repositoryRoot: focus.repositoryRoot,
        proposalId,
        recoverStale: async () => { throw new Error("unexpected stale recovery") },
      })).rejects.toThrow("APPLICATION_PROPOSAL_LOCK_UNCERTAIN")
    } finally { rename.mockRestore() }
    expect(fs.existsSync(lockPath)).toBe(false)
    const claim = await acquireApplicationRepositoryLock({
      runtimeRoot: focus.runtimeRoot,
      repositoryRoot: focus.repositoryRoot,
      proposalId,
      recoverStale: async () => { throw new Error("unexpected stale recovery") },
    })
    releaseApplicationRepositoryLock(claim)
  })

  it("retries a transient Windows-style recovery-claim replacement failure", async () => {
    const focus = await fixture("focus-board")
    const realRename = fs.renameSync.bind(fs)
    let failed = false
    const rename = vi.spyOn(fs, "renameSync").mockImplementation(((source: fs.PathLike, destination: fs.PathLike) => {
      if (!failed && /\.reap-[0-9a-f-]+\.json$/i.test(String(destination))) {
        failed = true
        const error = Object.assign(new Error("simulated sharing violation"), { code: "EPERM" })
        throw error
      }
      return realRename(source, destination)
    }) as typeof fs.renameSync)
    try {
      await expect(withApplicationRepositoryRecoveryClaim({
        runtimeRoot: focus.runtimeRoot,
        repositoryRoot: focus.repositoryRoot,
        action: async () => "recovered",
      })).resolves.toBe("recovered")
    } finally { rename.mockRestore() }
  })

  it("reconciles a terminal proposal lock after bounded release failures", async () => {
    const focus = await fixture("focus-board")
    const proposal = await createApplicationProposal({
      application: focus.application,
      runtimeRoot: focus.runtimeRoot,
      requestedBy: "owner",
      requestText: "Update the theme",
      executionRoute: "cerebras-qwen-3-8-27b",
      externalRoutingEnabled: true,
      externalEgressApproved: true,
      cerebrasTurn: externalTurn({ "assets/theme.css": "main { color: teal; }\n" }),
      validateWorkspace: validation,
    })
    const lockPath = applicationRepositoryLockPath(focus.runtimeRoot, focus.repositoryRoot)
    const realRename = fs.renameSync.bind(fs)
    const rename = vi.spyOn(fs, "renameSync").mockImplementation(((source: fs.PathLike, destination: fs.PathLike) => {
      if (path.resolve(String(source)) === path.resolve(lockPath) && String(destination).endsWith(".release")) {
        const error = Object.assign(new Error("simulated persistent release failure"), { code: "EPERM" })
        throw error
      }
      return realRename(source, destination)
    }) as typeof fs.renameSync)
    let applied
    try {
      applied = await applyApplicationProposal({
        application: focus.application,
        runtimeRoot: focus.runtimeRoot,
        proposalId: proposal.proposalId,
        requestedBy: "owner",
        validateWorkspace: validation,
      })
    } finally { rename.mockRestore() }
    expect(applied.status).toBe("APPLIED")
    expect(fs.existsSync(lockPath)).toBe(true)
    await expect(applyApplicationProposal({
      application: focus.application,
      runtimeRoot: focus.runtimeRoot,
      proposalId: proposal.proposalId,
      requestedBy: "owner",
      validateWorkspace: validation,
    })).resolves.toEqual(expect.objectContaining({ status: "APPLIED" }))
    expect(fs.existsSync(lockPath)).toBe(false)
  })

  it("recovers a same-process lock left after a nonterminal Apply rollback", async () => {
    const focus = await fixture("focus-board")
    const proposal = await createApplicationProposal({
      application: focus.application,
      runtimeRoot: focus.runtimeRoot,
      requestedBy: "owner",
      requestText: "Update the theme",
      executionRoute: "cerebras-qwen-3-8-27b",
      externalRoutingEnabled: true,
      externalEgressApproved: true,
      cerebrasTurn: externalTurn({ "assets/theme.css": "main { color: teal; }\n" }),
      validateWorkspace: validation,
    })
    const lockPath = applicationRepositoryLockPath(focus.runtimeRoot, focus.repositoryRoot)
    const realRename = fs.renameSync.bind(fs)
    const rename = vi.spyOn(fs, "renameSync").mockImplementation(((source: fs.PathLike, destination: fs.PathLike) => {
      if (path.resolve(String(source)) === path.resolve(lockPath) && String(destination).endsWith(".release")) {
        const error = Object.assign(new Error("simulated persistent release failure"), { code: "EPERM" })
        throw error
      }
      return realRename(source, destination)
    }) as typeof fs.renameSync)
    try {
      await expect(applyApplicationProposal({
        application: focus.application,
        runtimeRoot: focus.runtimeRoot,
        proposalId: proposal.proposalId,
        requestedBy: "owner",
        validateWorkspace: validation,
        transactionOperations: {
          checkpoint(stage: string) {
            if (stage === "validated") throw new Error("simulated pre-publication failure")
          },
        },
      })).rejects.toThrow("APPLICATION_PROPOSAL_LOCK_UNCERTAIN")
    } finally { rename.mockRestore() }
    expect(getApplicationProposal({
      applicationId: "focus-board",
      runtimeRoot: focus.runtimeRoot,
      proposalId: proposal.proposalId,
      requestedBy: "owner",
    }).status).toBe("READY_FOR_REVIEW")
    expect(fs.existsSync(lockPath)).toBe(true)
    await expect(applyApplicationProposal({
      application: focus.application,
      runtimeRoot: focus.runtimeRoot,
      proposalId: proposal.proposalId,
      requestedBy: "owner",
      validateWorkspace: validation,
    })).resolves.toEqual(expect.objectContaining({ status: "APPLIED" }))
    expect(fs.existsSync(lockPath)).toBe(false)
  })

  it("quarantines an ambiguous abandoned Apply instead of expiring it by age", async () => {
    const focus = await fixture("focus-board")
    const proposal = await createApplicationProposal({
      application: focus.application,
      runtimeRoot: focus.runtimeRoot,
      requestedBy: "owner",
      requestText: "Update the page",
      executionRoute: "cerebras-qwen-3-8-27b",
      externalRoutingEnabled: true,
      externalEgressApproved: true,
      cerebrasTurn: externalTurn({ "web/page.html": "<main>Candidate</main>\n" }),
      validateWorkspace: validation,
    })
    const abandoned = await abandonedRepositoryLock(focus.runtimeRoot, focus.repositoryRoot, proposal.proposalId)
    const receiptPath = path.join(focus.runtimeRoot, "application-proposals", "focus-board", `${proposal.proposalId}.json`)
    const receipt = JSON.parse(fs.readFileSync(receiptPath, "utf8"))
    fs.writeFileSync(receiptPath, `${JSON.stringify({
      ...receipt,
      status: "APPLY_IN_PROGRESS",
      applyStartedAt: new Date().toISOString(),
      applyToken: abandoned.claim.token,
      applyProcessId: abandoned.claim.processId,
    }, null, 2)}\n`)
    fs.writeFileSync(path.join(focus.repositoryRoot, "web/page.html"), "ambiguous owner-or-crash bytes\n")
    await expect(applyApplicationProposal({
      application: focus.application,
      runtimeRoot: focus.runtimeRoot,
      proposalId: proposal.proposalId,
      requestedBy: "owner",
      validateWorkspace: validation,
    })).rejects.toThrow("APPLICATION_PROPOSAL_QUARANTINED")
    expect(getApplicationProposal({
      applicationId: "focus-board",
      runtimeRoot: focus.runtimeRoot,
      proposalId: proposal.proposalId,
      requestedBy: "owner",
    })).toEqual(expect.objectContaining({
      status: "QUARANTINED_ROLLBACK_FAILED",
      quarantineReason: "APPLICATION_PROPOSAL_APPLY_RECOVERY_UNCERTAIN",
    }))
  }, 15_000)

  it("does not synthesize APPLIED during recovery when another bound file is dirty", async () => {
    const focus = await fixture("focus-board")
    const proposal = await createApplicationProposal({
      application: focus.application,
      runtimeRoot: focus.runtimeRoot,
      requestedBy: "owner",
      requestText: "Update the theme",
      executionRoute: "cerebras-qwen-3-8-27b",
      externalRoutingEnabled: true,
      externalEgressApproved: true,
      cerebrasTurn: externalTurn({ "assets/theme.css": "main { color: teal; }\n" }),
      validateWorkspace: validation,
    })
    const abandoned = await abandonedRepositoryLock(focus.runtimeRoot, focus.repositoryRoot, proposal.proposalId)
    const receiptPath = path.join(focus.runtimeRoot, "application-proposals", "focus-board", `${proposal.proposalId}.json`)
    const receipt = JSON.parse(fs.readFileSync(receiptPath, "utf8"))
    fs.writeFileSync(receiptPath, `${JSON.stringify({
      ...receipt,
      status: "APPLY_IN_PROGRESS",
      applyStartedAt: new Date().toISOString(),
      applyToken: abandoned.claim.token,
      applyProcessId: abandoned.claim.processId,
    }, null, 2)}\n`)
    const entry = git(focus.repositoryRoot, "ls-tree", proposal.candidateSha, "--", "assets/theme.css")
    const match = /^(100644|100755) blob ([0-9a-f]+)/.exec(entry)!
    fs.writeFileSync(path.join(focus.repositoryRoot, "assets/theme.css"), "main { color: teal; }\n")
    execFileSync("git", ["-C", focus.repositoryRoot, "update-index", "--add", "--cacheinfo", `${match[1]},${match[2]},assets/theme.css`], { windowsHide: true })
    execFileSync("git", ["-C", focus.repositoryRoot, "update-ref", "HEAD", proposal.candidateSha, proposal.baseSha], { windowsHide: true })
    fs.writeFileSync(path.join(focus.repositoryRoot, "web/page.html"), "owner changed another bound file\n")

    await expect(applyApplicationProposal({
      application: focus.application,
      runtimeRoot: focus.runtimeRoot,
      proposalId: proposal.proposalId,
      requestedBy: "owner",
      validateWorkspace: validation,
    })).rejects.toThrow("APPLICATION_PROPOSAL_QUARANTINED")
    expect(getApplicationProposal({
      applicationId: "focus-board",
      runtimeRoot: focus.runtimeRoot,
      proposalId: proposal.proposalId,
      requestedBy: "owner",
    }).status).toBe("QUARANTINED_ROLLBACK_FAILED")
    expect(fs.readFileSync(path.join(focus.repositoryRoot, "web/page.html"), "utf8")).toBe("owner changed another bound file\n")
  }, 15_000)

  it.each(["missing-bound-file", "corrupt-patch"])(
    "quarantines a token-bound abandoned Apply when proof throws: %s",
    async (failureMode) => {
      const focus = await fixture("focus-board")
      const proposal = await createApplicationProposal({
        application: focus.application,
        runtimeRoot: focus.runtimeRoot,
        requestedBy: "owner",
        requestText: "Update the theme",
        executionRoute: "cerebras-qwen-3-8-27b",
        externalRoutingEnabled: true,
        externalEgressApproved: true,
        cerebrasTurn: externalTurn({ "assets/theme.css": "main { color: teal; }\n" }),
        validateWorkspace: validation,
      })
      const abandoned = await abandonedRepositoryLock(focus.runtimeRoot, focus.repositoryRoot, proposal.proposalId)
      const receiptPath = path.join(focus.runtimeRoot, "application-proposals", "focus-board", `${proposal.proposalId}.json`)
      const receipt = JSON.parse(fs.readFileSync(receiptPath, "utf8"))
      fs.writeFileSync(receiptPath, `${JSON.stringify({
        ...receipt,
        status: "APPLY_IN_PROGRESS",
        applyStartedAt: new Date().toISOString(),
        applyToken: abandoned.claim.token,
        applyProcessId: abandoned.claim.processId,
      }, null, 2)}\n`)
      if (failureMode === "missing-bound-file") fs.unlinkSync(path.join(focus.repositoryRoot, "web/page.html"))
      else fs.writeFileSync(path.join(focus.runtimeRoot, "application-proposals", "focus-board", `${proposal.proposalId}.patch`), "corrupt patch\n")

      await expect(applyApplicationProposal({
        application: focus.application,
        runtimeRoot: focus.runtimeRoot,
        proposalId: proposal.proposalId,
        requestedBy: "owner",
        validateWorkspace: validation,
      })).rejects.toThrow("APPLICATION_PROPOSAL_QUARANTINED")
      const quarantinePath = path.join(focus.runtimeRoot, "application-proposals", "focus-board", `${proposal.proposalId}.quarantine.json`)
      expect(JSON.parse(fs.readFileSync(quarantinePath, "utf8"))).toEqual(expect.objectContaining({
        status: "QUARANTINED_ROLLBACK_FAILED",
        quarantineReason: "APPLICATION_PROPOSAL_APPLY_RECOVERY_UNCERTAIN",
      }))
      const historical = getApplicationProposal({
        applicationId: "focus-board",
        runtimeRoot: focus.runtimeRoot,
        proposalId: proposal.proposalId,
        requestedBy: "owner",
      })
      expect(historical.status).toBe("QUARANTINED_ROLLBACK_FAILED")
      if (failureMode === "corrupt-patch") expect(historical.reviewPatch).toBeNull()
      const lockPath = applicationRepositoryLockPath(focus.runtimeRoot, focus.repositoryRoot)
      expect(fs.existsSync(lockPath)).toBe(false)
      const nextClaim = await acquireApplicationRepositoryLock({
        runtimeRoot: focus.runtimeRoot,
        repositoryRoot: focus.repositoryRoot,
        proposalId: "22222222-2222-4222-8222-222222222222",
        recoverStale: async () => { throw new Error("unexpected stale lock") },
      })
      releaseApplicationRepositoryLock(nextClaim)
      expect(fs.existsSync(lockPath)).toBe(false)
    },
    15_000,
  )

  it("quarantines failed live Apply when another manifest-bound file changes concurrently", async () => {
    const focus = await fixture("focus-board")
    const proposal = await createApplicationProposal({
      application: focus.application,
      runtimeRoot: focus.runtimeRoot,
      requestedBy: "owner",
      requestText: "Update the theme",
      executionRoute: "cerebras-qwen-3-8-27b",
      externalRoutingEnabled: true,
      externalEgressApproved: true,
      cerebrasTurn: externalTurn({ "assets/theme.css": "main { color: teal; }\n" }),
      validateWorkspace: validation,
    })

    await expect(applyApplicationProposal({
      application: focus.application,
      runtimeRoot: focus.runtimeRoot,
      proposalId: proposal.proposalId,
      requestedBy: "owner",
      validateWorkspace: validation,
      transactionOperations: {
        checkpoint(stage: string) {
          if (stage !== "before_publish") return
          fs.writeFileSync(path.join(focus.repositoryRoot, "web/page.html"), "concurrent owner bytes\n")
          throw new Error("simulated apply interruption")
        },
      },
    })).rejects.toThrow("APPLICATION_PROPOSAL_ROLLBACK_FAILED")
    expect(getApplicationProposal({
      applicationId: "focus-board",
      runtimeRoot: focus.runtimeRoot,
      proposalId: proposal.proposalId,
      requestedBy: "owner",
    })).toEqual(expect.objectContaining({
      status: "QUARANTINED_ROLLBACK_FAILED",
      quarantineReason: "APPLICATION_PROPOSAL_ROLLBACK_FAILED",
    }))
    expect(fs.readFileSync(path.join(focus.repositoryRoot, "web/page.html"), "utf8")).toBe("concurrent owner bytes\n")
  })

  it("restores an exact reviewable base across every Apply crash checkpoint", async () => {
    const focus = await fixture("focus-board")
    const stages = ["validated", "canonical_write", "before_publish", "published", "index_synced", "receipt_replace"]
    for (const failedStage of stages) {
      const proposal = await createApplicationProposal({
        application: focus.application,
        runtimeRoot: focus.runtimeRoot,
        requestedBy: "owner",
        requestText: `Update the theme before ${failedStage}`,
        executionRoute: "cerebras-qwen-3-8-27b",
        externalRoutingEnabled: true,
        externalEgressApproved: true,
        cerebrasTurn: externalTurn({ "assets/theme.css": `main { color: ${failedStage}; }\n` }),
        validateWorkspace: validation,
      })
      await expect(applyApplicationProposal({
        application: focus.application,
        runtimeRoot: focus.runtimeRoot,
        proposalId: proposal.proposalId,
        requestedBy: "owner",
        validateWorkspace: validation,
        transactionOperations: {
          checkpoint(stage: string) {
            if (stage === failedStage) throw new Error(`simulated interruption at ${failedStage}`)
          },
        },
      })).rejects.toThrow(`simulated interruption at ${failedStage}`)
      expect(getApplicationProposal({
        applicationId: "focus-board",
        runtimeRoot: focus.runtimeRoot,
        proposalId: proposal.proposalId,
        requestedBy: "owner",
      }).status).toBe("READY_FOR_REVIEW")
      expect(git(focus.repositoryRoot, "rev-parse", "HEAD")).toBe(proposal.baseSha)
      expect(fs.readFileSync(path.join(focus.repositoryRoot, "assets/theme.css"), "utf8")).toBe("main { color: navy; }\n")
      expect(git(focus.repositoryRoot, "status", "--porcelain", "--", ".williamos/application.json", "web/page.html", "assets/theme.css", "client/main.js", "test/application.test.mjs")).toBe("")
    }
    expect(git(focus.repositoryRoot, "worktree", "list", "--porcelain").match(/^worktree /gm)).toHaveLength(1)
  }, 60_000)

  it("does not let a reused live PID impersonate the original repository-lock process", async () => {
    const focus = await fixture("focus-board")
    const lockPath = applicationRepositoryLockPath(focus.runtimeRoot, focus.repositoryRoot)
    fs.mkdirSync(path.dirname(lockPath), { recursive: true })
    fs.writeFileSync(lockPath, `${JSON.stringify({
      schemaVersion: 2,
      token: "11111111-1111-4111-8111-111111111111",
      processId: process.pid,
      processIdentity: process.platform === "win32" ? "win:0000000000" : process.platform === "linux" ? "linux:0" : "posix:not-the-current-process",
      startedAt: new Date().toISOString(),
      repositoryDigest: applicationRepositoryLockIdentity(focus.repositoryRoot),
      proposalId: "22222222-2222-4222-8222-222222222222",
    }, null, 2)}\n`)
    const recoverStale = vi.fn(async () => {})
    const claim = await acquireApplicationRepositoryLock({
      runtimeRoot: focus.runtimeRoot,
      repositoryRoot: focus.repositoryRoot,
      proposalId: "33333333-3333-4333-8333-333333333333",
      recoverStale,
    })
    expect(recoverStale).toHaveBeenCalledWith(expect.objectContaining({ processId: process.pid }))
    releaseApplicationRepositoryLock(claim)
  })

  it("recovers a dead pre-process-identity v1 repository lock after upgrade", async () => {
    const focus = await fixture("focus-board")
    const lockPath = applicationRepositoryLockPath(focus.runtimeRoot, focus.repositoryRoot)
    fs.mkdirSync(path.dirname(lockPath), { recursive: true })
    fs.writeFileSync(lockPath, `${JSON.stringify({
      schemaVersion: 1,
      token: "11111111-1111-4111-8111-111111111111",
      processId: 2_147_483_647,
      startedAt: new Date().toISOString(),
      repositoryDigest: applicationRepositoryLockIdentity(focus.repositoryRoot),
      proposalId: "22222222-2222-4222-8222-222222222222",
    }, null, 2)}\n`)
    const recoverStale = vi.fn(async () => {})
    const claim = await acquireApplicationRepositoryLock({
      runtimeRoot: focus.runtimeRoot,
      repositoryRoot: focus.repositoryRoot,
      proposalId: "33333333-3333-4333-8333-333333333333",
      recoverStale,
    })
    expect(recoverStale).toHaveBeenCalledWith(expect.objectContaining({ schemaVersion: 1, processId: 2_147_483_647 }))
    expect(claim.value.schemaVersion).toBe(2)
    releaseApplicationRepositoryLock(claim)
  })

  it("reaps a dead pre-process-identity v1 recovery claimant after upgrade", async () => {
    const focus = await fixture("focus-board")
    const repositoryDigest = applicationRepositoryLockIdentity(focus.repositoryRoot)
    const token = "11111111-1111-4111-8111-111111111111"
    const directory = path.join(focus.runtimeRoot, "application-proposal-locks")
    fs.mkdirSync(directory, { recursive: true })
    const legacy = path.join(directory, `${repositoryDigest}.reap-${token}.json`)
    fs.writeFileSync(legacy, `${JSON.stringify({
      schemaVersion: 1,
      token,
      processId: 2_147_483_647,
      startedAt: new Date().toISOString(),
      repositoryDigest,
      ticket: 1,
    }, null, 2)}\n`)
    await expect(withApplicationRepositoryRecoveryClaim({
      runtimeRoot: focus.runtimeRoot,
      repositoryRoot: focus.repositoryRoot,
      action: async () => "upgraded",
    })).resolves.toBe("upgraded")
    expect(fs.existsSync(legacy)).toBe(false)
  })

  it("never guesses that a live same-PID v1 lock or recovery claimant is stale", async () => {
    const focus = await fixture("focus-board")
    const repositoryDigest = applicationRepositoryLockIdentity(focus.repositoryRoot)
    const token = "11111111-1111-4111-8111-111111111111"
    const lockPath = applicationRepositoryLockPath(focus.runtimeRoot, focus.repositoryRoot)
    fs.mkdirSync(path.dirname(lockPath), { recursive: true })
    const legacyLock = {
      schemaVersion: 1,
      token,
      processId: process.pid,
      startedAt: new Date().toISOString(),
      repositoryDigest,
      proposalId: "22222222-2222-4222-8222-222222222222",
    }
    fs.writeFileSync(lockPath, `${JSON.stringify(legacyLock, null, 2)}\n`)
    const recoverStale = vi.fn(async () => {})
    await expect(acquireApplicationRepositoryLock({
      runtimeRoot: focus.runtimeRoot,
      repositoryRoot: focus.repositoryRoot,
      proposalId: "33333333-3333-4333-8333-333333333333",
      recoverStale,
    })).rejects.toThrow("APPLICATION_PROPOSAL_REPOSITORY_BUSY")
    expect(recoverStale).not.toHaveBeenCalled()
    fs.unlinkSync(lockPath)

    fs.writeFileSync(lockPath, `${JSON.stringify({ ...legacyLock, processIdentity: "linux:123" }, null, 2)}\n`)
    await expect(acquireApplicationRepositoryLock({
      runtimeRoot: focus.runtimeRoot,
      repositoryRoot: focus.repositoryRoot,
      proposalId: "33333333-3333-4333-8333-333333333333",
      recoverStale,
    })).rejects.toThrow("APPLICATION_PROPOSAL_LOCK_UNCERTAIN")
    expect(recoverStale).not.toHaveBeenCalled()
    fs.unlinkSync(lockPath)

    const reaper = path.join(path.dirname(lockPath), `${repositoryDigest}.reap-${token}.json`)
    fs.writeFileSync(reaper, `${JSON.stringify({
      schemaVersion: 1,
      token,
      processId: process.pid,
      startedAt: new Date().toISOString(),
      repositoryDigest,
      ticket: 1,
    }, null, 2)}\n`)
    await expect(withApplicationRepositoryRecoveryClaim({
      runtimeRoot: focus.runtimeRoot,
      repositoryRoot: focus.repositoryRoot,
      waitMs: 25,
      action: async () => "unreachable",
    })).rejects.toThrow("APPLICATION_PROPOSAL_REPOSITORY_BUSY")
    expect(fs.existsSync(reaper)).toBe(true)
    fs.unlinkSync(reaper)

    fs.writeFileSync(reaper, `${JSON.stringify({
      schemaVersion: 1,
      token,
      processId: process.pid,
      processIdentity: "linux:123",
      startedAt: new Date().toISOString(),
      repositoryDigest,
      ticket: 1,
    }, null, 2)}\n`)
    await expect(withApplicationRepositoryRecoveryClaim({
      runtimeRoot: focus.runtimeRoot,
      repositoryRoot: focus.repositoryRoot,
      waitMs: 25,
      action: async () => "unreachable",
    })).rejects.toThrow("APPLICATION_PROPOSAL_LOCK_UNCERTAIN")
    expect(fs.existsSync(reaper)).toBe(true)
    fs.unlinkSync(reaper)
  })

  it("does not overwrite a concurrently replaced APPLY_IN_PROGRESS receipt", async () => {
    const focus = await fixture("focus-board")
    const proposal = await createApplicationProposal({
      application: focus.application,
      runtimeRoot: focus.runtimeRoot,
      requestedBy: "owner",
      requestText: "Update the theme",
      executionRoute: "cerebras-qwen-3-8-27b",
      externalRoutingEnabled: true,
      externalEgressApproved: true,
      cerebrasTurn: externalTurn({ "assets/theme.css": "main { color: teal; }\n" }),
      validateWorkspace: validation,
    })
    const receiptPath = path.join(focus.runtimeRoot, "application-proposals", "focus-board", `${proposal.proposalId}.json`)
    await expect(applyApplicationProposal({
      application: focus.application,
      runtimeRoot: focus.runtimeRoot,
      proposalId: proposal.proposalId,
      requestedBy: "owner",
      validateWorkspace: validation,
      transactionOperations: {
        checkpoint(stage: string) {
          if (stage !== "receipt_replace") return
          const competing = JSON.parse(fs.readFileSync(receiptPath, "utf8"))
          competing.requestText = "concurrent valid receipt replacement"
          competing.requestSha256 = createHash("sha256").update(competing.requestText).digest("hex")
          fs.writeFileSync(receiptPath, `${JSON.stringify(competing, null, 2)}\n`)
        },
      },
    })).rejects.toThrow("APPLICATION_PROPOSAL_ROLLBACK_FAILED")
    expect(getApplicationProposal({
      applicationId: "focus-board",
      runtimeRoot: focus.runtimeRoot,
      proposalId: proposal.proposalId,
      requestedBy: "owner",
    }).status).toBe("QUARANTINED_ROLLBACK_FAILED")
    expect(git(focus.repositoryRoot, "rev-parse", "HEAD")).toBe(proposal.baseSha)
    expect(fs.readFileSync(path.join(focus.repositoryRoot, "assets/theme.css"), "utf8")).toBe("main { color: navy; }\n")
  })

  it("never publishes a proposal through a same-SHA symbolic HEAD switch", async () => {
    const focus = await fixture("focus-board")
    const proposal = await createApplicationProposal({
      application: focus.application,
      runtimeRoot: focus.runtimeRoot,
      requestedBy: "owner",
      requestText: "Update the theme",
      executionRoute: "cerebras-qwen-3-8-27b",
      externalRoutingEnabled: true,
      externalEgressApproved: true,
      cerebrasTurn: externalTurn({ "assets/theme.css": "main { color: teal; }\n" }),
      validateWorkspace: validation,
    })
    await expect(applyApplicationProposal({
      application: focus.application,
      runtimeRoot: focus.runtimeRoot,
      proposalId: proposal.proposalId,
      requestedBy: "owner",
      validateWorkspace: validation,
      transactionOperations: {
        checkpoint(stage: string) {
          if (stage === "before_publish") git(focus.repositoryRoot, "checkout", "-b", "owner-switch")
        },
      },
    })).rejects.toThrow("APPLICATION_PROPOSAL_ROLLBACK_FAILED")
    expect(git(focus.repositoryRoot, "symbolic-ref", "HEAD")).toBe("refs/heads/owner-switch")
    expect(git(focus.repositoryRoot, "rev-parse", "refs/heads/main")).toBe(proposal.baseSha)
    expect(git(focus.repositoryRoot, "rev-parse", "refs/heads/owner-switch")).toBe(proposal.baseSha)
    expect(getApplicationProposal({
      applicationId: "focus-board",
      runtimeRoot: focus.runtimeRoot,
      proposalId: proposal.proposalId,
      requestedBy: "owner",
    }).status).toBe("QUARANTINED_ROLLBACK_FAILED")
  })

  it("treats an independently durable quarantine marker as authoritative after receipt replacement fails", async () => {
    const focus = await fixture("focus-board")
    const proposal = await createApplicationProposal({
      application: focus.application,
      runtimeRoot: focus.runtimeRoot,
      requestedBy: "owner",
      requestText: "Update the page",
      executionRoute: "cerebras-qwen-3-8-27b",
      externalRoutingEnabled: true,
      externalEgressApproved: true,
      cerebrasTurn: externalTurn({ "web/page.html": "<main>Candidate</main>\n" }),
      validateWorkspace: validation,
    })
    const abandoned = await abandonedRepositoryLock(focus.runtimeRoot, focus.repositoryRoot, proposal.proposalId)
    const receiptPath = path.join(focus.runtimeRoot, "application-proposals", "focus-board", `${proposal.proposalId}.json`)
    const receipt = JSON.parse(fs.readFileSync(receiptPath, "utf8"))
    fs.writeFileSync(receiptPath, `${JSON.stringify({
      ...receipt,
      status: "APPLY_IN_PROGRESS",
      applyStartedAt: new Date().toISOString(),
      applyToken: abandoned.claim.token,
      applyProcessId: abandoned.claim.processId,
    }, null, 2)}\n`)
    fs.writeFileSync(path.join(focus.repositoryRoot, "web/page.html"), "ambiguous owner-or-crash bytes\n")
    const realRename = fs.renameSync.bind(fs)
    const rename = vi.spyOn(fs, "renameSync").mockImplementation(((source: fs.PathLike, destination: fs.PathLike) => {
      if (path.resolve(String(destination)) === path.resolve(receiptPath)) throw new Error("simulated receipt replacement failure")
      return realRename(source, destination)
    }) as typeof fs.renameSync)
    try {
      await expect(applyApplicationProposal({
        application: focus.application,
        runtimeRoot: focus.runtimeRoot,
        proposalId: proposal.proposalId,
        requestedBy: "owner",
        validateWorkspace: validation,
      })).rejects.toThrow("APPLICATION_PROPOSAL_QUARANTINED")
    } finally { rename.mockRestore() }
    expect(getApplicationProposal({
      applicationId: "focus-board",
      runtimeRoot: focus.runtimeRoot,
      proposalId: proposal.proposalId,
      requestedBy: "owner",
    })).toEqual(expect.objectContaining({
      status: "QUARANTINED_ROLLBACK_FAILED",
      quarantineReason: "APPLICATION_PROPOSAL_APPLY_RECOVERY_UNCERTAIN",
    }))
  }, 15_000)
})
