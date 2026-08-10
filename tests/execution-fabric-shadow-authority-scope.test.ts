import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"

import { describe, expect, it } from "vitest"

describe("Execution Fabric shadow authority scope contract", () => {
  it("binds WO-EF-SHADOW-004 to the reviewed operator-only local proof without activating it", () => {
    const root = process.cwd()
    const contract = JSON.parse(fs.readFileSync(path.join(
      root, "config", "execution-fabric", "shadow-authority-scopes", "WO-EF-SHADOW-004.json",
    ), "utf8"))
    const forgeBytes = fs.readFileSync(path.join(root, contract.agent_forge_permission.source_path))
    const forgeSha = crypto.createHash("sha256").update(forgeBytes).digest("hex")

    expect(Object.keys(contract).sort()).toEqual([
      "activation", "agent_forge_permission", "allowed_actions", "autonomous_dispatch",
      "brain_council_role", "forbidden_actions", "producer", "risk_class", "scheduler_state",
      "schema_version", "scope_id", "task", "work_order_id",
    ])
    expect(contract).toMatchObject({
      schema_version: "0.1-shadow-authority-scope-contract",
      work_order_id: "WO-EF-SHADOW-004",
      risk_class: "R0_LOCAL_PROOF",
      producer: { provider: "resident-hermes", node_id: "hermes-node" },
      task: {
        template_id: "existing-loopback-llm-inference-v1",
        workload_id: "gpu-local-inference",
        maximum_calls: 1,
        timeout_seconds: 60,
      },
      activation: {
        state: "REVIEWED_SCOPE_ONLY_NOT_ACTIVE",
        requires_separate_future_dated_registry_activation: true,
        may_execute_from_this_contract: false,
      },
      brain_council_role: "ADVISORY_ONLY",
      scheduler_state: "OFF",
      autonomous_dispatch: false,
    })
    expect(contract.agent_forge_permission).toMatchObject({
      permission_area: "LOCAL_PROOF_BY_OPERATOR",
      posture: "operator-only",
      runtime_activation: false,
      source_sha256: forgeSha,
    })
    expect(contract.forbidden_actions).toEqual(expect.arrayContaining([
      "scheduler activation",
      "autonomous dispatch",
      "external provider access",
    ]))
  })
})
