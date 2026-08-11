#!/usr/bin/node
import net from "node:net"

const SOCKET_PATH = "/run/williamos-fabric/aegis-remote-dev-git-broker.sock"
const ticketB64 = process.env.WILLIAMOS_NETWORK_TICKET_B64 ?? ""
const packetB64 = process.env.WILLIAMOS_NETWORK_PACKET_B64 ?? ""
const operation = process.env.WILLIAMOS_NETWORK_OPERATION ?? ""
const base64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/
const OPERATION_TIMEOUT_MS = Object.freeze({ PROVE_PREFLIGHT: 920_000, CREATE_WORKSPACE: 620_000, PUSH_AUTHORIZED_BRANCH: 320_000, PROVE_POST_MERGE: 320_000 })

function finish(status, reasonCode) {
  process.stdout.write(`${JSON.stringify({ status, reasonCode })}\n`)
  process.exitCode = status === "GIT_OPERATION_VERIFIED" ? 0 : 2
}

if (process.argv.length !== 2 || !["PROVE_PREFLIGHT", "CREATE_WORKSPACE", "PUSH_AUTHORIZED_BRANCH", "PROVE_POST_MERGE"].includes(operation) || !base64.test(ticketB64) || !base64.test(packetB64) || ticketB64.length > 100_000 || packetB64.length > 1_500_000) {
  finish("BLOCKED", "GIT_BROKER_INPUT_REJECTED")
} else {
  const request = `${JSON.stringify({ packetB64, ticketB64 })}\n`
  const socket = net.createConnection({ path: SOCKET_PATH }); let response = Buffer.alloc(0); let settled = false
  const fail = () => { if (!settled) { settled = true; socket.destroy(); finish("BLOCKED", "GIT_BROKER_UNAVAILABLE") } }
  socket.setTimeout(OPERATION_TIMEOUT_MS[operation])
  socket.once("connect", () => socket.end(request))
  socket.on("data", (chunk) => { response = Buffer.concat([response, chunk]); if (response.length > 65_536) fail() })
  socket.once("timeout", fail); socket.once("error", fail)
  socket.once("end", () => {
    if (settled) return
    settled = true
    try {
      const value = JSON.parse(response.toString("utf8"))
      if (Object.keys(value).sort().join(",") !== "head,reasonCode,status" || value.status !== "GIT_OPERATION_VERIFIED" || value.reasonCode !== "GIT_OPERATION_VERIFIED" || !/^[a-f0-9]{40}$/.test(value.head)) throw new Error("response differs")
      process.stdout.write(`${JSON.stringify(value)}\n`); process.exitCode = 0
    } catch { finish("BLOCKED", "GIT_BROKER_RESPONSE_REJECTED") }
  })
}
