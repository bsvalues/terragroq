import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { JSDOM } from "jsdom"

test("appliance UI preserves unknown authority, explains criticality, and suppresses stale claims", () => {
  const html = readFileSync("scripts/lab-control/hermes/console/public/index.html", "utf8")
  const js = readFileSync("scripts/lab-control/hermes/console/public/app.js", "utf8")
  assert.ok(!js.includes("\ufffd"))
  const dom=new JSDOM(html,{runScripts:"outside-only"})
  const {window}=dom
  window.fetch=()=>new Promise(()=>{})
  window.setInterval=()=>0
  window.eval(js)
  const domains=Object.fromEntries(["appliance","inference","protection","storage","security","doctrine","workbench"].map(name=>[name,{state:name==="doctrine"?"CRITICAL":"HEALTHY",headline:name==="doctrine"?"Permanent host drift detected":"Current",facts:[]}]))
  const status={freshness:{state:"FRESH",ageSeconds:2},overallState:"CRITICAL",domains,alerts:[],ownerActions:[],authorityState:"UNAVAILABLE",activeWork:{state:"UNAVAILABLE",headline:"No authenticated work source connected"},observedAt:new Date().toISOString()}
  window.eval(`render(${JSON.stringify(status)})`)
  assert.equal(window.document.querySelector("#overall-title").textContent,"HERMES has critical findings.")
  assert.match(window.document.querySelector("#overall-summary").textContent,/Permanent host drift/)
  assert.match(window.document.querySelector("#owner-state strong").textContent,/Unknown/)
  assert.ok(!window.document.querySelector("#overall-summary").textContent.includes("in progress"))
  status.freshness.state="STALE"
  window.eval(`render(${JSON.stringify(status)})`)
  assert.ok([...window.document.querySelectorAll(".domain-state")].every(node=>node.textContent==="UNKNOWN"))
  assert.equal(window.document.querySelector("#work-state").textContent,"UNAVAILABLE")
  dom.window.close()
})
