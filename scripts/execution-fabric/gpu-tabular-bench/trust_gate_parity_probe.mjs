// Reads {"gate": ..., "authority": ...} JSON on stdin and prints the adapter's decision as JSON.
// Used by trust_gate_parity.py to compare this adapter against the referenced Python gate.
import { assertPreventiveTrustGateV2 } from "../gpu-tabular-capability.mjs"

let input = ""
process.stdin.setEncoding("utf8")
process.stdin.on("data", (chunk) => { input += chunk })
process.stdin.on("end", () => {
  const { gate, authority } = JSON.parse(input)
  process.stdout.write(JSON.stringify(assertPreventiveTrustGateV2(gate, authority)))
})
