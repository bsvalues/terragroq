import fs from "node:fs"
import os from "node:os"

import { createSingleShotDispatchStore } from "../runtime/single-shot-dispatch-store.mjs"

const statePath = "C:\\HermesLab\\bounded-dispatch-ledger\\dispatch-state-v02.json"

if (process.platform !== "win32" || os.hostname().toLowerCase() !== "hermes") {
  throw new Error("resident HERMES identity is required")
}

const existed = fs.existsSync(statePath)
const store = createSingleShotDispatchStore(statePath, {
  storeId: "execution-fabric-resident-hermes-v02",
})
if (!existed) store.initialize()
const state = store.read()

process.stdout.write(`${JSON.stringify({
  schema_version: "0.1-resident-hermes-ledger-genesis-result",
  status: existed ? "EXISTING_VALID_GENESIS" : "GENESIS_CREATED",
  genesis_sha256: state.genesis_sha256,
  store_id: state.store_id,
  revision: state.revision,
  dispatch_count: Object.keys(state.dispatches).length,
}, null, 2)}\n`)
