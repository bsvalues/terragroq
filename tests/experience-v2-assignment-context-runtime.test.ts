import { createHash } from "node:crypto"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { afterEach, beforeEach, describe, expect, it } from "vitest"

import type { CodexAssignment } from "@/lib/loom/codex-assignment"
import type { CodexIsolatedWorkspace } from "@/lib/loom/codex-isolated-workspace"
import {
  AssignmentContextRuntimeError,
  createCodexAssignmentContextManifest,
  createRepositoryAssignmentContextManifest,
} from "@/lib/loom/assignment-context-runtime"
import type { WorkspaceProjectBinding } from "@/lib/projects/workspace-project-binding"

const SHA_A = "a".repeat(40)
const SHA_B = "b".repeat(40)
const SHA_D = "d".repeat(40)
const DIGEST_B = "b".repeat(64)
const DIGEST_C = "c".repeat(64)

let temporaryRoot = ""
let projectRoot = ""
let isolatedRoot = ""

beforeEach(async () => {
  temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "williamos-context-runtime-"))
  projectRoot = path.join(temporaryRoot, "atlas-main")
  isolatedRoot = path.join(temporaryRoot, "runtime", "codex-worktrees", "delegate-assignment-atlas-001")
  await fs.mkdir(path.join(isolatedRoot, "src", "spatial-read"), { recursive: true })
  await fs.writeFile(path.join(isolatedRoot, "AGENTS.md"), "root instructions\n", "utf8")
  await fs.writeFile(path.join(isolatedRoot, "src", "spatial-read", "AGENTS.md"), "nested instructions\n", "utf8")
  await fs.writeFile(path.join(isolatedRoot, "CLAUDE.md"), "claude instructions\n", "utf8")
  await fs.mkdir(path.join(isolatedRoot, "canon"), { recursive: true })
  await fs.writeFile(path.join(isolatedRoot, "canon", "INTAKE_RULES.md"), "atlas intake rules\n", "utf8")
  await fs.writeFile(path.join(isolatedRoot, "canon", "CONTRACT_DEPENDENCY.md"), "atlas contract dependency\n", "utf8")
  await fs.mkdir(projectRoot, { recursive: true })
})

afterEach(async () => {
  await fs.rm(temporaryRoot, { recursive: true, force: true })
})

function binding(overrides: Partial<WorkspaceProjectBinding> = {}): WorkspaceProjectBinding {
  return {
    projectId: 2,
    projectKey: "terrafusion",
    projectName: "TerraFusion",
    repositoryResourceId: 11,
    repositoryKey: "atlas",
    repositoryIdentity: "bsvalues/terrafusion-atlas",
    repositoryRole: "suite-source",
    repositoryLabel: "Atlas",
    repositoryPreviewSource: false,
    repositoryMountKey: "terrafusion:atlas:configured",
    observedRevision: SHA_A,
    configuredWorkspaceRoot: projectRoot,
    workspaceRoot: projectRoot,
    workspaceAppUrl: null,
    project: {
      identity: "terrafusion-project",
      name: "TerraFusion",
      repositories: [
        {
          repositoryResourceId: 11,
          key: "atlas",
          identity: "bsvalues/terrafusion-atlas",
          label: "Atlas",
          role: "suite-source",
          suite: "atlas",
          previewSource: false,
          defaultRepository: false,
          mount: { key: "terrafusion:atlas:configured", configured: true, verified: true, branch: "main", revision: SHA_A, refusal: null },
        },
        {
          repositoryResourceId: 12,
          key: "os-1",
          identity: "bsvalues/terrafusion_os_1.0",
          label: "OS 1.0",
          role: "integrated-runtime",
          suite: null,
          previewSource: true,
          defaultRepository: true,
          mount: { key: "terrafusion:os-1:configured", configured: true, verified: true, branch: "main", revision: SHA_B, refusal: null },
        },
        {
          repositoryResourceId: 13,
          key: "sovereign-os",
          identity: "bsvalues/terrafusion-os",
          label: "Sovereign OS",
          role: "sovereign-planning-and-promotion",
          suite: null,
          previewSource: false,
          defaultRepository: false,
          mount: { key: "terrafusion:sovereign-os:configured", configured: true, verified: true, branch: "main", revision: SHA_D, refusal: null },
        },
      ],
    },
    ...overrides,
  }
}

function assignment(overrides: Partial<CodexAssignment> = {}): CodexAssignment {
  return {
    owner: "owner-1",
    worldId: "space-atlas-integration",
    projectRoot,
    outcomeKey: "TERRAFUSION-ATLAS-INTEGRATION",
    workOrderId: 1109,
    grantId: 27,
    selectedPath: "src/spatial-read/project-atlas-feature.mjs",
    selectedFileRef: {
      projectIdentity: "terrafusion-project",
      repositoryResourceKey: "atlas",
      repositoryMountKey: "terrafusion:atlas:configured",
      worktreeKey: null,
      observedRevision: SHA_A,
      path: "src/spatial-read/project-atlas-feature.mjs",
    },
    allowed: ["src/spatial-read/**"],
    forbidden: ["docs/**"],
    binding: {
      spaceRevision: 5,
      outcomeId: 17,
      outcomeVersion: 3,
      workOrderRef: "WO-ATLAS-1109",
      workOrderVersion: "2026-09-02T18:20:00.000Z",
      grantRef: "GRANT-ATLAS-1109",
      grantVersion: DIGEST_C,
      reservationVersion: DIGEST_B,
      projectId: 2,
      projectKey: "terrafusion",
      repositoryResourceKey: "atlas",
      repositoryIdentity: "bsvalues/terrafusion-atlas",
      repositoryMountKey: "terrafusion:atlas:configured",
      observedRevision: SHA_A,
      spaceIdentity: "terrafusion-project",
    },
    assignmentHash: DIGEST_B,
    target: {
      content: "export const feature = true\n",
      modifiedAt: "2026-09-02T18:29:00.000Z",
      digest: DIGEST_C,
    },
    ...overrides,
  }
}

function isolated(overrides: Partial<CodexIsolatedWorkspace> = {}): CodexIsolatedWorkspace {
  return {
    projectRoot,
    runtimeRoot: path.dirname(isolatedRoot),
    root: isolatedRoot,
    baseSha: SHA_A,
    selectedPath: "src/spatial-read/project-atlas-feature.mjs",
    initialContentDigest: DIGEST_C,
    ...overrides,
  }
}

const createdAt = "2026-09-02T18:30:00.000Z"

const REFERENCE_BYTES = new Map([
  ["os-1:AGENTS.md", "os1 instructions\n"],
  ["os-1:CLAUDE.md", "os1 claude instructions\n"],
  ["os-1:docs/architecture/TERRAFUSION_SUITE_CONSTITUTION_v1.md", "suite constitution\n"],
  ["os-1:docs/architecture/specs/terrafusion/04_SUITE_BOUNDARIES_WRITE_LANES_v3.1.md", "suite write lanes\n"],
  ["os-1:brain/packs/README.md", "brain pack index\n"],
  ["os-1:brain/packs/atlas/README.md", "atlas brain pack\n"],
  ["sovereign-os:AGENTS.md", "sovereign instructions\n"],
  ["sovereign-os:CLAUDE.md", "sovereign claude instructions\n"],
  ["sovereign-os:canon/SOVEREIGN_PLAN.md", "sovereign plan\n"],
  ["sovereign-os:canon/EXECUTION_CONSTITUTION.md", "execution constitution\n"],
  ["sovereign-os:canon/BRAIN_AUTHORITY_BOUNDARY.md", "brain authority boundary\n"],
])

function runtimeDependencies(overrides: Record<string, unknown> = {}) {
  return {
    nodeIdentity: () => "HERMES",
    loadWorkOrder: async (workOrderId: number) => ({
      id: workOrderId,
      ref: "WO-ATLAS-1109",
      version: "2026-09-02T18:20:00.000Z",
      status: "active",
      content: JSON.stringify({
        title: "Atlas projection integration",
        goal: "Deliver the Atlas projection contract",
        allowedFiles: ["src/spatial-read/**"],
        forbiddenFiles: ["docs/**"],
        acceptanceCriteria: ["contract is proven"],
      }),
      allowedFiles: ["src/spatial-read/**"],
    }),
    configuredRepositoryRoot: (environmentName: string) => environmentName.includes("SOVEREIGN")
      ? "verified-sovereign-root"
      : "verified-os1-root",
    inspectRepository: async (root: string) => root.includes("sovereign")
      ? { repositoryIdentity: "bsvalues/terrafusion-os", revisionIdentity: SHA_D }
      : { repositoryIdentity: "bsvalues/terrafusion_os_1.0", revisionIdentity: SHA_B },
    readRepositoryBlob: async (root: string, _revision: string, sourcePath: string) => {
      const key = `${root.includes("sovereign") ? "sovereign-os" : "os-1"}:${sourcePath}`
      const value = REFERENCE_BYTES.get(key)
      return value === undefined ? null : Buffer.from(value, "utf8")
    },
    ...overrides,
  }
}

describe("Experience V2 assignment context runtime", () => {
  it("builds the same exact context evidence for another repository-writing provider", async () => {
    const manifest = await createRepositoryAssignmentContextManifest({
      assignment: {
        assignmentId: "claude-assignment-atlas-001",
        worldId: "space-atlas-integration",
        workOrderId: 1109,
        assignmentHash: DIGEST_B,
        createdAt,
        selectedPath: "src/spatial-read/project-atlas-feature.mjs",
        writablePaths: ["src/spatial-read/project-atlas-feature.mjs"],
        projectId: 2,
        projectKey: "terrafusion",
        repositoryKey: "atlas",
        repositoryIdentity: "bsvalues/terrafusion-atlas",
        repositoryMountKey: "terrafusion:atlas:configured",
        observedRevision: SHA_A,
        spaceIdentity: "terrafusion-project",
        projectRoot,
        targetDigest: DIGEST_C,
      },
      projectBinding: binding(),
      isolatedWorkspace: isolated(),
    }, runtimeDependencies({ nodeIdentity: () => "OMEN" }))

    expect(manifest.assignment.assignmentId).toBe("claude-assignment-atlas-001")
    expect(manifest.checkout.nodeIdentity).toBe("omen")
    expect(manifest.mutationPosture.target.writablePaths).toEqual([
      "src/spatial-read/project-atlas-feature.mjs",
    ])
    expect(manifest.authorityEffect).toBe("none")
  })

  it("builds exact immutable context from the verified Atlas checkout and its applicable instructions", async () => {
    const manifest = await createCodexAssignmentContextManifest({
      assignment: assignment(),
      assignmentId: "assignment-atlas-001",
      assignmentCreatedAt: createdAt,
      projectBinding: binding(),
      isolatedWorkspace: isolated(),
    }, runtimeDependencies())

    expect(manifest.assignment).toEqual({
      assignmentId: "assignment-atlas-001",
      worldId: "space-atlas-integration",
      workOrderId: 1109,
      assignmentHash: DIGEST_B,
      createdAt,
    })
    expect(manifest.targetRepository).toEqual({
      repositoryResourceId: 11,
      repositoryKey: "atlas",
      repositoryIdentity: "bsvalues/terrafusion-atlas",
      role: "suite-source",
      suite: "atlas",
    })
    expect(manifest.checkout).toEqual({
      repositoryMountKey: "terrafusion:atlas:configured",
      nodeIdentity: "hermes",
      worktreeKey: "delegate-assignment-atlas-001",
      baseRevision: SHA_A,
    })
    expect(manifest.workOrder).toEqual(expect.objectContaining({
      id: 1109,
      ref: "WO-ATLAS-1109",
      version: "2026-09-02T18:20:00.000Z",
      status: "active",
      content: expect.stringContaining("Atlas projection integration"),
      contentHash: expect.stringMatching(/^[0-9a-f]{64}$/),
    }))
    expect(manifest.mutationPosture).toEqual({
      target: {
        repositoryResourceId: 11,
        repositoryKey: "atlas",
        repositoryIdentity: "bsvalues/terrafusion-atlas",
        access: "write-under-assignment-reservation",
        writablePaths: ["src/spatial-read/**"],
      },
      references: [
        {
          repositoryResourceId: 12,
          repositoryKey: "os-1",
          repositoryIdentity: "bsvalues/terrafusion_os_1.0",
          role: "integrated-runtime",
          revisionIdentity: SHA_B,
          access: "read-only",
        },
        {
          repositoryResourceId: 13,
          repositoryKey: "sovereign-os",
          repositoryIdentity: "bsvalues/terrafusion-os",
          role: "sovereign-planning-and-promotion",
          revisionIdentity: SHA_D,
          access: "read-only",
        },
      ],
    })
    expect(manifest.sources).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "instruction",
        path: "AGENTS.md",
        blobHash: createHash("sha256").update("root instructions\n").digest("hex"),
      }),
      expect.objectContaining({
        kind: "instruction",
        path: "CLAUDE.md",
        blobHash: createHash("sha256").update("claude instructions\n").digest("hex"),
      }),
      expect.objectContaining({
        kind: "cross-repository-contract",
        path: "canon/CONTRACT_DEPENDENCY.md",
        blobHash: createHash("sha256").update("atlas contract dependency\n").digest("hex"),
      }),
      expect.objectContaining({
        kind: "instruction",
        path: "src/spatial-read/AGENTS.md",
        blobHash: createHash("sha256").update("nested instructions\n").digest("hex"),
      }),
      expect.objectContaining({ kind: "project-knowledge", repositoryKey: "os-1", path: "brain/packs/atlas/README.md" }),
      expect.objectContaining({ kind: "project-knowledge", repositoryKey: "sovereign-os", path: "canon/SOVEREIGN_PLAN.md" }),
    ]))
    expect(new Set(manifest.sources.map((source) => source.repositoryKey))).toEqual(new Set(["atlas", "os-1", "sovereign-os"]))
    expect(manifest.authorityEffect).toBe("none")
  })

  it("does not invent an unrelated nested instruction or unrelated Brain document", async () => {
    await fs.mkdir(path.join(isolatedRoot, "src", "other"), { recursive: true })
    await fs.writeFile(path.join(isolatedRoot, "src", "other", "AGENTS.md"), "other instructions\n", "utf8")
    await fs.mkdir(path.join(isolatedRoot, "docs", "brain"), { recursive: true })
    await fs.writeFile(path.join(isolatedRoot, "docs", "brain", "ATLAS_CONTEXT.md"), "not loaded\n", "utf8")

    const manifest = await createCodexAssignmentContextManifest({
      assignment: assignment(), assignmentId: "assignment-atlas-001", assignmentCreatedAt: createdAt,
      projectBinding: binding(), isolatedWorkspace: isolated(),
    }, runtimeDependencies())

    expect(manifest.sources.map((source) => source.path)).not.toContain("src/other/AGENTS.md")
    expect(manifest.sources.map((source) => source.path)).not.toContain("docs/brain/ATLAS_CONTEXT.md")
  })

  it("loads the OS 1.0 project Brain and exact Sovereign reference context for an integrated-runtime assignment", async () => {
    await fs.mkdir(path.join(isolatedRoot, "brain", "packs"), { recursive: true })
    await fs.writeFile(path.join(isolatedRoot, "brain", "packs", "README.md"), "runtime brain index\n", "utf8")
    const os1Binding = binding({
      repositoryResourceId: 12,
      repositoryKey: "os-1",
      repositoryIdentity: "bsvalues/terrafusion_os_1.0",
      repositoryRole: "integrated-runtime",
      repositoryLabel: "OS 1.0",
      repositoryPreviewSource: true,
      repositoryMountKey: "terrafusion:os-1:configured",
      observedRevision: SHA_B,
    })
    const manifest = await createRepositoryAssignmentContextManifest({
      assignment: {
        assignmentId: "codex-assignment-os1-001",
        worldId: "space-os1-integration",
        workOrderId: 1109,
        assignmentHash: DIGEST_B,
        createdAt,
        selectedPath: "src/runtime.ts",
        writablePaths: ["src/**"],
        projectId: 2,
        projectKey: "terrafusion",
        repositoryKey: "os-1",
        repositoryIdentity: "bsvalues/terrafusion_os_1.0",
        repositoryMountKey: "terrafusion:os-1:configured",
        observedRevision: SHA_B,
        spaceIdentity: "terrafusion-project",
        projectRoot,
        targetDigest: DIGEST_C,
      },
      projectBinding: os1Binding,
      isolatedWorkspace: isolated({ baseSha: SHA_B, selectedPath: "src/runtime.ts" }),
    }, runtimeDependencies({
      loadWorkOrder: async () => ({
        id: 1109,
        ref: "WO-OS1-1109",
        version: "2026-09-02T18:20:00.000Z",
        status: "active",
        content: '{"title":"OS1 integration"}',
        allowedFiles: ["src/**"],
      }),
    }))

    expect(manifest.sources).toEqual(expect.arrayContaining([
      expect.objectContaining({ repositoryKey: "os-1", path: "brain/packs/README.md", kind: "project-knowledge" }),
      expect.objectContaining({ repositoryKey: "sovereign-os", path: "canon/SOVEREIGN_PLAN.md", kind: "project-knowledge" }),
    ]))
    expect(manifest.mutationPosture.references.map((reference) => reference.repositoryKey)).toEqual(["sovereign-os"])
  })

  it.each([
    ["missing resource id", () => binding({ repositoryResourceId: null })],
    ["wrong project", () => binding({ projectId: 99 })],
    ["wrong repository key", () => binding({ repositoryKey: "forge" })],
    ["wrong canonical repository", () => binding({ repositoryIdentity: "bsvalues/terrafusion-forge" })],
    ["wrong repository role", () => binding({ repositoryRole: "integrated-runtime" })],
    ["wrong mount", () => binding({ repositoryMountKey: "terrafusion:atlas:other" })],
    ["missing revision", () => binding({ observedRevision: null })],
  ])("fails closed for %s", async (_label, changedBinding) => {
    await expect(createCodexAssignmentContextManifest({
      assignment: assignment(), assignmentId: "assignment-atlas-001", assignmentCreatedAt: createdAt,
      projectBinding: changedBinding(), isolatedWorkspace: isolated(),
    }, runtimeDependencies())).rejects.toBeInstanceOf(AssignmentContextRuntimeError)
  })

  it.each([
    ["selected repository", assignment({ selectedFileRef: { ...assignment().selectedFileRef!, repositoryResourceKey: "forge" } })],
    ["selected mount", assignment({ selectedFileRef: { ...assignment().selectedFileRef!, repositoryMountKey: "terrafusion:atlas:other" } })],
    ["selected revision", assignment({ selectedFileRef: { ...assignment().selectedFileRef!, observedRevision: "d".repeat(40) } })],
    ["selected path", assignment({ selectedFileRef: { ...assignment().selectedFileRef!, path: "src/other.ts" } })],
    ["assignment repository identity", assignment({ binding: { ...assignment().binding, repositoryIdentity: "bsvalues/terrafusion-forge" } })],
    ["assignment mount identity", assignment({ binding: { ...assignment().binding, repositoryMountKey: "terrafusion:atlas:other" } })],
    ["assignment revision", assignment({ binding: { ...assignment().binding, observedRevision: "d".repeat(40) } })],
  ])("rejects a mismatched %s", async (_label, changedAssignment) => {
    await expect(createCodexAssignmentContextManifest({
      assignment: changedAssignment, assignmentId: "assignment-atlas-001", assignmentCreatedAt: createdAt,
      projectBinding: binding(), isolatedWorkspace: isolated(),
    }, runtimeDependencies())).rejects.toMatchObject({ code: "ASSIGNMENT_CONTEXT_BINDING_MISMATCH" })
  })

  it("rejects an isolated checkout that is not the exact assigned repository revision and path", async () => {
    await expect(createCodexAssignmentContextManifest({
      assignment: assignment(), assignmentId: "assignment-atlas-001", assignmentCreatedAt: createdAt,
      projectBinding: binding(), isolatedWorkspace: isolated({ baseSha: "d".repeat(40) }),
    }, runtimeDependencies())).rejects.toMatchObject({ code: "ASSIGNMENT_CONTEXT_CHECKOUT_MISMATCH" })
  })

  it("requires one exact regular root AGENTS.md instead of manufacturing context", async () => {
    await fs.rm(path.join(isolatedRoot, "AGENTS.md"))

    await expect(createCodexAssignmentContextManifest({
      assignment: assignment(), assignmentId: "assignment-atlas-001", assignmentCreatedAt: createdAt,
      projectBinding: binding(), isolatedWorkspace: isolated(),
    }, runtimeDependencies())).rejects.toMatchObject({ code: "ASSIGNMENT_CONTEXT_INSTRUCTIONS_MISSING" })
  })

  it("rejects a non-file applicable instruction source and an absent node identity", async () => {
    await fs.rm(path.join(isolatedRoot, "src", "spatial-read", "AGENTS.md"))
    await fs.mkdir(path.join(isolatedRoot, "src", "spatial-read", "AGENTS.md"))

    await expect(createCodexAssignmentContextManifest({
      assignment: assignment(), assignmentId: "assignment-atlas-001", assignmentCreatedAt: createdAt,
      projectBinding: binding(), isolatedWorkspace: isolated(),
    }, runtimeDependencies())).rejects.toMatchObject({ code: "ASSIGNMENT_CONTEXT_INSTRUCTION_INVALID" })

    await fs.rm(path.join(isolatedRoot, "src", "spatial-read", "AGENTS.md"), { recursive: true })
    await expect(createCodexAssignmentContextManifest({
      assignment: assignment(), assignmentId: "assignment-atlas-001", assignmentCreatedAt: createdAt,
      projectBinding: binding(), isolatedWorkspace: isolated(),
    }, runtimeDependencies({ nodeIdentity: () => "" }))).rejects.toMatchObject({ code: "ASSIGNMENT_CONTEXT_NODE_INVALID" })
  })

  it("fails closed when required Work Order, Brain, contract, or sovereign context cannot be proven", async () => {
    const run = (overrides: Record<string, unknown>) => createCodexAssignmentContextManifest({
      assignment: assignment(), assignmentId: "assignment-atlas-001", assignmentCreatedAt: createdAt,
      projectBinding: binding(), isolatedWorkspace: isolated(),
    }, runtimeDependencies(overrides))

    await expect(run({ loadWorkOrder: async () => null }))
      .rejects.toMatchObject({ code: "ASSIGNMENT_CONTEXT_WORK_ORDER_MISSING" })
    await expect(run({ readRepositoryBlob: async (root: string, revision: string, sourcePath: string) => (
      sourcePath === "brain/packs/atlas/README.md"
        ? null
        : runtimeDependencies().readRepositoryBlob(root, revision, sourcePath)
    ) }))
      .rejects.toMatchObject({ code: "ASSIGNMENT_CONTEXT_SOURCE_MISSING" })
    await expect(run({ inspectRepository: async (root: string) => root.includes("sovereign")
      ? { repositoryIdentity: "bsvalues/terrafusion-os", revisionIdentity: "e".repeat(40) }
      : { repositoryIdentity: "bsvalues/terrafusion_os_1.0", revisionIdentity: SHA_B } }))
      .rejects.toMatchObject({ code: "ASSIGNMENT_CONTEXT_REFERENCE_INVALID" })
  })
})
