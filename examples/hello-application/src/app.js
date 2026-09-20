export function nextPulseSnapshot(current, now = new Date()) {
  const previousCount = Number.isInteger(current?.count) && current.count >= 0 ? current.count : 0
  const count = previousCount + 1
  const signalNumber = String(count).padStart(3, "0")
  const timestamp = now.toISOString().slice(11, 19)

  return {
    count,
    detail: `Signal ${signalNumber} received at ${timestamp} UTC`,
    status: `Pulse ${signalNumber} received.`,
  }
}

export function mountHelloApplication(root = document) {
  const button = root.getElementById("send-pulse")
  const countOutput = root.getElementById("pulse-count")
  const detailOutput = root.getElementById("pulse-detail")
  const statusOutput = root.getElementById("pulse-status")
  const governanceMarker = root.getElementById("governance-marker")
  const trace = root.getElementById("signal-track")

  if (!button || !countOutput || !detailOutput || !statusOutput || !trace) return null

  let snapshot = { count: 0 }
  let animationTimer

  const sendPulse = () => {
    snapshot = nextPulseSnapshot(snapshot)
    const pulseNumber = String(snapshot.count).padStart(3, "0")
    countOutput.textContent = pulseNumber
    detailOutput.textContent = snapshot.detail
    statusOutput.textContent = snapshot.status
    if (governanceMarker) governanceMarker.textContent = `Governed by HERMES · pulse ${pulseNumber}`

    trace.dataset.state = "idle"
    void trace.offsetWidth
    trace.dataset.state = "sent"
    clearTimeout(animationTimer)
    animationTimer = setTimeout(() => {
      trace.dataset.state = "idle"
    }, 760)
    button.textContent = "Send another pulse";
    button.dataset.state = "sent";
  }

  button.addEventListener("click", sendPulse)
  return {
    destroy() {
      clearTimeout(animationTimer)
      button.removeEventListener("click", sendPulse)
    },
    sendPulse,
  }
}

if (typeof document !== "undefined") {
  mountHelloApplication(document)
}
