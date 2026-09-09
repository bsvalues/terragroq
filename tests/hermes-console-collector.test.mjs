import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { spawnSync } from "node:child_process"
import { validateHermesStatus } from "../scripts/lab-control/hermes/console/lib/status-contract.mjs"

test("collector survives partial evidence and distinguishes recovered health from retained alerts", { skip: process.platform !== "win32" }, () => {
  const root = mkdtempSync(join(tmpdir(), "hermes-collector-"))
  try {
    const write = (name, value) => { const path=join(root,name); writeFileSync(path, JSON.stringify(value)); return path }
    const health = write("health.json", {})
    const owner = write("owner.json", { schema: "hermes-ollama-owner-state/1" })
    const doctrine = write("doctrine.json", { evaluatedAt: new Date().toISOString() })
    const receipt = write("restore.json", { status: "PASS" })
    const settings = write("settings.json", { CustomWslDistroDir: "G:\\DockerDesktopWSL" })
    const alerts=join(root,"alerts.log")
    const now=new Date(); const pad=x=>String(x).padStart(2,"0")
    const stamp=`${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`
    writeFileSync(alerts, `${stamp} [WARN] Recovered test event\n2026-99-99 99:99 [FAIL] Invalid date\n`)
    const recovery=join(root,"backups"); mkdirSync(recovery)
    const output=join(root,"current.json")
    const collect=()=>{
      const run=spawnSync("pwsh", ["-NoProfile","-File","scripts/lab-control/hermes/console/collect-hermes-console-status.ps1", "-OutputPath",output,"-NativeHealthPath",health,"-CanonicalOwnerStatePath",owner,"-DoctrineResultPath",doctrine,"-RestoreReceiptPath",receipt,"-NativeAlertsPath",alerts,"-RecoveryRoot",recovery,"-DockerSettingsPath",settings,"-DockerDataPath",join(root,"missing.vhdx")], { encoding:"utf8",timeout:60000 })
      assert.equal(run.status,0,run.stderr)
      return validateHermesStatus(JSON.parse(readFileSync(output,"utf8")))
    }
    let status=collect()
    assert.equal(status.domains.appliance.state,"UNKNOWN")
    assert.equal(status.domains.doctrine.state,"UNKNOWN")
    assert.notEqual(status.domains.workbench.state,"HEALTHY")
    assert.equal(status.activeWork.state,"UNAVAILABLE")
    assert.equal(status.authorityState,"UNAVAILABLE")
    writeFileSync(health,JSON.stringify({timestamp:new Date(Date.now()-30*60*1000).toISOString(),domains:{hermes:{overall:"ok",problems:[]}}}))
    writeFileSync(doctrine,JSON.stringify({schema:"hermes-doctrine-result/1",status:"FAIL",code:"HERMES_DOCTRINE_DRIFT",observedAt:new Date().toISOString(),evaluatedAt:new Date().toISOString(),freshness:{state:"FRESH"},drift:{listeners:{}}}))
    status=collect()
    assert.equal(status.domains.appliance.state,"HEALTHY")
    assert.equal(status.domains.doctrine.state,"CRITICAL")
    assert.equal(status.domains.doctrine.facts.find(f=>f.label==="Freshness").value,"Within 10 minutes")
    assert.equal(status.alerts.length,1)
    assert.equal(status.alerts[0].message,"Recovered test event")
    assert.equal(status.domains.appliance.facts.find(f=>f.label==="Evidence freshness").value,"FRESH")
    writeFileSync(health,JSON.stringify({timestamp:new Date(Date.now()-76*60*1000).toISOString(),domains:{hermes:{overall:"ok",problems:[]}}}))
    status=collect()
    assert.equal(status.domains.appliance.state,"UNKNOWN")
    assert.equal(status.domains.appliance.facts.find(f=>f.label==="Evidence freshness").value,"STALE / UNAVAILABLE")
  } finally { rmSync(root,{recursive:true,force:true}) }
})
