// Two listeners, one per candidate DATABASE_URL. Whichever the application connects to is the one
// its configuration actually resolved to -- observed at the socket rather than inferred from an
// error message that need not name a port.
//
//   5551 = the value in .env.local
//   5552 = the value already in process.env
//
// Each connection is appended to the log THE MOMENT it arrives. An earlier version totalled the
// counts and wrote them on exit, which recorded nothing: Stop-Process on Windows terminates rather
// than delivering SIGTERM, so the writer never ran and a real connection read as "none observed".
// Evidence that only exists if the process is shut down politely is evidence that goes missing
// exactly when something has gone wrong.
import net from "node:net"
import fs from "node:fs"

const [outFile] = process.argv.slice(2)
fs.writeFileSync(outFile, "", "utf8")

for (const port of [5551, 5552]) {
  net
    .createServer((socket) => {
      fs.appendFileSync(outFile, `${JSON.stringify({ port, at: new Date().toISOString() })}\n`, "utf8")
      socket.destroy()
    })
    .listen(port, "127.0.0.1")
}
