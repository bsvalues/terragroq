#!/usr/bin/env node
import fs from "node:fs"

import {
  acquireLaneLease,
  checkpointLaneLease,
  expireLaneLease,
  heartbeatLaneLease,
  inspectLaneLeaseStore,
  reclaimLaneLease,
  releaseLaneLease,
  renewLaneLease,
} from "./lane-lease-checkpoint.mjs"

const [command, storePath, storeId, requestPath, ...rest] = process.argv.slice(2)
const operations = {
  acquire: acquireLaneLease,
  reclaim: reclaimLaneLease,
  renew: renewLaneLease,
  heartbeat: heartbeatLaneLease,
  checkpoint: checkpointLaneLease,
  release: releaseLaneLease,
  expire: expireLaneLease,
}

function output(value, exitCode) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)
  process.exitCode = exitCode
}

if (rest.length > 0 || !storePath || !storeId || !(command === "inspect" || Object.hasOwn(operations, command))
  || (command === "inspect" ? requestPath !== undefined : !requestPath)) {
  output({
    schemaVersion: 1,
    artifactType: "MULTI_AGENT_LANE_LEASE_CHECKPOINT_CLI_RESULT",
    ok: false,
    status: "LANE_LEASE_CHECKPOINT_CLI_USAGE_WALL",
    localFilesOnly: true,
    authorityGranted: false,
  }, 2)
} else {
  let result
  if (command === "inspect") {
    result = inspectLaneLeaseStore(storePath, storeId)
  } else {
    try {
      const request = JSON.parse(fs.readFileSync(requestPath, "utf8"))
      result = operations[command](storePath, storeId, request)
    } catch {
      result = {
        schemaVersion: 1,
        artifactType: "MULTI_AGENT_LANE_LEASE_CHECKPOINT_CLI_RESULT",
        ok: false,
        status: "LANE_LEASE_CHECKPOINT_CLI_INPUT_WALL",
        localFilesOnly: true,
        authorityGranted: false,
      }
    }
  }
  output(result, result.ok ? 0 : 3)
}
