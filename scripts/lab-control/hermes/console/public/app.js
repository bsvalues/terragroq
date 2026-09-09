const domainLabels = {
  appliance: ["Appliance", "Native HERMES health and persistent alert owner"],
  inference: ["AI", "P40 inference and model service"],
  protection: ["Protection", "Backup, off-host copy, and restore proof"],
  storage: ["Storage", "System, data, and workbench roles"],
  security: ["Security", "Firewall, ingress, and exposed services"],
  doctrine: ["Doctrine", "Declared versus observed appliance state"],
  workbench: ["Workbench", "Disposable development capability"],
}

const escapeHtml = (value) => String(value).replace(/[&<>'"]/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
}[char]))

function card(name, domain) {
  const [label, description] = domainLabels[name]
  const facts = domain.facts.map((fact) => `<li><span>${escapeHtml(fact.label)}</span><strong>${escapeHtml(fact.value)}</strong></li>`).join("")
  return `<details class="domain-card ${domain.state.toLowerCase()}">
    <summary>
      <span class="state-dot" aria-hidden="true"></span>
      <span class="domain-copy"><small>${label}</small><strong>${escapeHtml(domain.headline)}</strong><em>${description}</em></span>
      <span class="domain-state">${domain.state}</span>
    </summary>
    <ul>${facts || "<li><span>Evidence</span><strong>Unavailable</strong></li>"}</ul>
  </details>`
}

function render(status) {
  const stale = status.freshness?.state !== "FRESH"
  const state = stale ? "UNKNOWN" : status.overallState
  const title = state === "HEALTHY" ? "HERMES is healthy." : state === "CRITICAL" ? "HERMES has critical findings." : "HERMES needs attention."
  const priorityDomain = Object.values(status.domains).find((domain) => domain.state === "CRITICAL")
    || Object.values(status.domains).find((domain) => domain.state === "DEGRADED" || domain.state === "UNKNOWN")
  document.querySelector("#overall-title").textContent = title
  document.querySelector("#overall-summary").textContent = stale
    ? "Current evidence is stale or unavailable. No green claim is being made."
    : status.ownerActions.length
      ? status.ownerActions[0].reason
      : priorityDomain
        ? `${priorityDomain.headline}.`
        : "Available appliance evidence is current."
  document.querySelector("#overall-orb").className = `orb ${state.toLowerCase()}`
  document.querySelector("#domain-grid").innerHTML = Object.entries(status.domains).map(([name, domain]) => card(name, stale ? { ...domain, state: "UNKNOWN" } : domain)).join("")
  const alerts = status.alerts.slice(-5).reverse()
  document.querySelector("#alert-list").innerHTML = alerts.length
    ? alerts.map((alert) => `<li class="${alert.severity.toLowerCase()}"><span>${escapeHtml(alert.observedAt)} · ${escapeHtml(alert.severity)}</span><strong>${escapeHtml(alert.message)}</strong></li>`).join("")
    : '<li class="clear"><strong>No alerts recorded in the last 48 hours.</strong></li>'
  document.querySelector("#work-headline").textContent = stale ? "Active work evidence unavailable" : status.activeWork.headline
  document.querySelector("#work-state").textContent = stale ? "UNAVAILABLE" : status.activeWork.state.replaceAll("_", " ")
  document.querySelector("#observed").textContent = `Observed ${new Date(status.observedAt).toLocaleString()}`
  const owner = document.querySelector("#owner-state")
  if (stale || status.authorityState !== "AVAILABLE") {
    owner.classList.remove("needs-action")
    owner.querySelector("strong").textContent = "Unknown - decision source unavailable"
  } else if (status.ownerActions.length) {
    owner.classList.add("needs-action")
    owner.querySelector("strong").textContent = `${status.ownerActions.length} decision${status.ownerActions.length === 1 ? "" : "s"}`
  } else {
    owner.classList.remove("needs-action")
    owner.querySelector("strong").textContent = "Nothing"
  }
  document.querySelector("#freshness").textContent = status.freshness?.state === "FRESH"
    ? `Evidence current · ${status.freshness.ageSeconds}s old`
    : "Evidence stale · green claims suppressed"
}

async function refresh() {
  try {
    const response = await fetch("/api/status", { cache: "no-store" })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    render(await response.json())
  } catch {
    document.querySelector("#overall-title").textContent = "Console evidence unavailable."
    document.querySelector("#overall-summary").textContent = "No health claim is being made."
    document.querySelector("#overall-orb").className = "orb unknown"
    document.querySelector("#domain-grid").innerHTML = ""
    document.querySelector("#owner-state strong").textContent = "Unknown"
    document.querySelector("#work-state").textContent = "UNAVAILABLE"
    document.querySelector("#work-headline").textContent = "Active work evidence unavailable"
  }
}

function tick() {
  document.querySelector("#clock").textContent = new Intl.DateTimeFormat([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date())
}

tick()
refresh()
setInterval(tick, 1000)
setInterval(refresh, 15000)
