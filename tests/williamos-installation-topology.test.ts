import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

const root = process.cwd()
const productContract = fs.readFileSync(path.join(root, "PRODUCT_EXECUTION.md"), "utf8")
const cockpitConfig = JSON.parse(fs.readFileSync(path.join(root, "cockpit", "cockpit.config.json"), "utf8"))
const cockpitReadme = fs.readFileSync(path.join(root, "cockpit", "README.md"), "utf8")

describe("the two-installation WilliamOS topology", () => {
  it("keeps HERMES as the explicitly named running anchor", () => {
    expect(productContract).toContain("two installations, one HERMES anchor")
    expect(productContract).toContain("HERMES installation:** the running anchor")
  })

  it("defines OMEN as the second client rather than a second authority", () => {
    expect(productContract).toContain("OMEN installation:** the second owner-facing WilliamOS client")
    expect(productContract).toContain("not two competing control planes")
    expect(productContract).toContain("OMEN does not replace HERMES as the running anchor")
  })

  it("binds both native surfaces to the canonical HERMES origin", () => {
    expect(cockpitConfig.hermesOrigin).toBe("https://williamos.lan:3443")
    expect(productContract).toContain(cockpitConfig.hermesOrigin)
    expect(cockpitReadme).toContain(cockpitConfig.hermesOrigin)
  })

  it("keeps the separate HERMES appliance outside the WilliamOS product boundary", () => {
    expect(productContract).toContain("appliance/observability experiment")
    expect(productContract).toContain("must not modify, repurpose, or depend on that appliance")
  })
})
