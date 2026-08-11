#!/usr/bin/node
import net from "node:net"
const [host, port] = process.argv.slice(2)
const ticket = process.env.WILLIAMOS_NETWORK_TICKET_B64 ?? ""
const operation = process.env.WILLIAMOS_NETWORK_OPERATION ?? ""
if (!/^(ssh\.github\.com|api\.github\.com|api\.nuget\.org|globalcdn\.nuget\.org)$/.test(host ?? "") || port !== "443" || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(ticket) || !/^[A-Z_]{1,64}$/.test(operation)) process.exitCode = 64
else {
  const socket = net.createConnection({ host: "127.0.0.1", port: 17734 }); let response = Buffer.alloc(0)
  socket.once("connect", () => socket.write(`CONNECT ${host}:443 HTTP/1.1\r\nHost: ${host}:443\r\nProxy-Authorization: WilliamOS ${ticket}\r\nX-WilliamOS-Operation: ${operation}\r\n\r\n`))
  socket.on("data", function handshake(chunk) {
    response = Buffer.concat([response, chunk]); const end = response.indexOf("\r\n\r\n")
    if (end < 0) { if (response.length > 4096) socket.destroy(); return }
    socket.off("data", handshake)
    if (!response.subarray(0, end).toString("ascii").startsWith("HTTP/1.1 200 ")) { socket.destroy(); process.exitCode = 2; return }
    const rest = response.subarray(end + 4); if (rest.length) process.stdout.write(rest); process.stdin.pipe(socket); socket.pipe(process.stdout)
  })
  socket.on("error", () => { process.exitCode = 2 })
}
