import { DOCTRINE_SCHEMA, OBSERVATION_SCHEMA, sha256 } from "./evaluate-hermes-doctrine.mjs"

export const FREEZE_SCHEMA = "hermes-appliance-freeze-acceptance/1"
const requiredGates = Object.freeze([
  "inference",
  "security",
  "offHostRecovery",
  "storageRoles",
  "workbench",
])

export function mintHermesDoctrine(observation, acceptance) {
  if (!observation || observation.schema !== OBSERVATION_SCHEMA) {
    throw new Error("HERMES_DOCTRINE_MINT_OBSERVATION_INVALID")
  }
  if (!acceptance || acceptance.schema !== FREEZE_SCHEMA) {
    throw new Error("HERMES_DOCTRINE_MINT_ACCEPTANCE_INVALID")
  }
  if (acceptance.hostIdentitySha256 !== observation.hostIdentitySha256) {
    throw new Error("HERMES_DOCTRINE_MINT_HOST_MISMATCH")
  }
  if (acceptance.observationSha256 !== sha256(observation)) {
    throw new Error("HERMES_DOCTRINE_MINT_OBSERVATION_MISMATCH")
  }
  const gateNames = Object.keys(acceptance.gates ?? {}).sort()
  if (JSON.stringify(gateNames) !== JSON.stringify([...requiredGates].sort())) {
    throw new Error("HERMES_DOCTRINE_MINT_GATE_SET_INVALID")
  }
  for (const gate of requiredGates) {
    if (acceptance.gates[gate] !== "PASS") {
      throw new Error(`HERMES_DOCTRINE_MINT_GATE_NOT_GREEN:${gate}`)
    }
  }

  return {
    schema: DOCTRINE_SCHEMA,
    applianceVersion: "HERMES_APPLIANCE_V1",
    frozenAt: acceptance.acceptedAt,
    hostIdentitySha256: observation.hostIdentitySha256,
    maxObservationAgeSeconds: 300,
    sourceObservationSha256: acceptance.observationSha256,
    acceptanceSha256: sha256(acceptance),
    inventory: observation.inventory,
  }
}
