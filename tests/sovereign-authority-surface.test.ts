import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"

import {
  AUTHORITY_RULE_ID,
  AuthoritySurfaceUnavailable,
  projectAuthorityRecord,
  resolveIntegrationsStatePath,
} from "@/lib/environment/sovereign-authority-surface"

/**
 * The authority surface's claim is that it reports what the lab integration record and the running
 * build ACTUALLY say — and that every unreadable/absent/malformed input is a typed refusal, never
 * an empty or defaulted answer. Both directions are pinned: a healthy record reads COMPLETE, and a
 * mirror failure changes the mirror line without ever touching the product line (the doctrine this
 * surface exists to make visible).
 */

const SEALED = {
  at: "2026-09-12T04:49:15.707Z",
  candidate: "22d348c59a6c42c7e46a7f1053187ebde275b76d",
  base: "42a7e80132a3b1bc71838a41ee6e4e817b4907d6",
  labMainBefore: "ca42297c1db3a21f1323d7097f8fec413d30315a",
  labMainAfter: "9670ba3e4359cc7198fbcdc7d78d04cfd0211669",
  sealKey: "f379482a85885de54ce82bfd",
  reviewerKey: "sovereign-reviewer-710e2a49a3da3d76b1aba0b9",
  productState: "COMPLETE",
  mirrorState: "IN_SYNC",
  mirrorDetail: "PR #1222 merged via governed path",
}
const LAGGED = { ...SEALED, at: "2026-09-12T16:28:54.000Z", labMainAfter: "47d1a69721282bdb576acdd7267b714c5d15e634", candidate: "e2a0e56fd71b0905c28404a4c9c3a7bb3d422964", mirrorState: "OUT_OF_SYNC", mirrorDetail: "mirror unreachable: blocked during acceptance" }
const PROV = (sha: string) => ({ sha, builtAt: "2026-09-12T13:37:46.541Z" })

describe("sovereign authority surface", () => {
  it("a real complete record reads COMPLETE with the authority rule attached — field-for-field from the writer's schema", () => {
    const s = projectAuthorityRecord({ integrations: [SEALED] }, PROV(SEALED.labMainAfter), "test://x")
    expect(s.authority.rule).toBe(AUTHORITY_RULE_ID)
    expect(s.authority.model).toBe("lab-git-authoritative")
    expect(s.product.state).toBe("COMPLETE")
    expect(s.product.detail).toContain(SEALED.labMainAfter.slice(0, 10))
    expect(s.product.detail).toContain(SEALED.candidate.slice(0, 10))
    expect(s.mirror.state).toBe("IN_SYNC")
    expect(s.mirror.laggingSince).toBeNull()
    expect(s.runtime.provenanceState).toBe("PROVEN_AT_AUTHORITY")
    expect(s.recentPromotions[0]).toEqual(SEALED)
    expect(s.product.promotions).toBe(1)
  })

  it("mirror failure NEVER moves the product line (the doctrine, pinned)", () => {
    const s = projectAuthorityRecord({ integrations: [SEALED, LAGGED] }, PROV(SEALED.labMainAfter), "test://x")
    expect(s.product.state).toBe("COMPLETE")
    expect(s.mirror.state).toBe("OUT_OF_SYNC")
    expect(s.mirror.laggingSince).toBe(LAGGED.at)
    expect(s.runtime.provenanceState).toBe("BUILD_LAGS_AUTHORITY") // door still on the prior head
    expect(s.product.promotions).toBe(2)
  })

  it("full history renders newest-first and the age window is computed, not assumed", () => {
    const nowMs = Date.parse("2026-09-12T18:28:54Z")
    const s = projectAuthorityRecord({ integrations: [SEALED, LAGGED] }, PROV(LAGGED.labMainAfter), "test://x", nowMs)
    expect(s.recentPromotions.map((r) => r.labMainAfter[0])).toEqual(["4", "9"])
    expect(s.runtime.provenanceState).toBe("PROVEN_AT_AUTHORITY")
    expect(s.staleness.ageHours).toBe(2)
    expect(s.staleness.withinWindow).toBe(true)
  })

  it.each([
    ["null record", null, "AUTHORITY_RECORD_MALFORMED"],
    ["missing integrations array", { integrations: "x" }, "AUTHORITY_RECORD_MALFORMED"],
    ["entry lacking labMainAfter", { integrations: [{ productState: "COMPLETE" }] }, "AUTHORITY_RECORD_MALFORMED"],
    ["empty history is honest", { integrations: [] }, null],
  ])("typed behavior: %s", (_label, input, code) => {
    if (code) {
      expect(() => projectAuthorityRecord(input, PROV("abc"), "test://x")).toThrowError(AuthoritySurfaceUnavailable)
      try { projectAuthorityRecord(input, PROV("abc"), "test://x") } catch (e) {
        expect((e as AuthoritySurfaceUnavailable).code).toBe(code)
      }
    } else {
      const s = projectAuthorityRecord(input, PROV("abc"), "test://x")
      expect(s.product.state).toBe("NO_AUTHORITY_RECORD")
      expect(s.runtime.provenanceState).toBe("NO_AUTHORITY_RECORD")
      expect(s.recentPromotions).toEqual([])
    }
  })

  it("unproven build provenance is BUILD_UNPROVEN, never a false match", () => {
    const s = projectAuthorityRecord({ integrations: [SEALED] }, { sha: "development", builtAt: null }, "test://x")
    expect(s.runtime.provenanceState).toBe("BUILD_UNPROVEN")
    expect(s.product.state).toBe("COMPLETE") // product verdict is independent of build identity
  })

  it("path resolution follows the writer's precedence and never hardcodes a home", () => {
    expect(resolveIntegrationsStatePath({ WILLIAMOS_INTEGRATIONS_STATE: "/custom/x.json" } as unknown as NodeJS.ProcessEnv)).toBe("/custom/x.json")
    const p = resolveIntegrationsStatePath({ USERPROFILE: "C:\\Users\\test" } as unknown as NodeJS.ProcessEnv)
    expect(p).toBe(path.join("C:\\Users\\test", ".williamos", "integrations.json"))
    expect(resolveIntegrationsStatePath({} as unknown as NodeJS.ProcessEnv)).toContain(".williamos")
  })

  it("production entry: a real written record round-trips through the same projection the tests pin", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "authority-surface-"))
    const file = path.join(dir, "integrations.json")
    fs.writeFileSync(file, JSON.stringify({ integrations: [SEALED, LAGGED] }))
    const s = projectAuthorityRecord(JSON.parse(fs.readFileSync(file, "utf8")), PROV(SEALED.labMainAfter), file)
    expect(s.product.state).toBe("COMPLETE")
    expect(s.mirror.state).toBe("OUT_OF_SYNC")
    expect(s.mirror.laggingSince).toBe(LAGGED.at)
    fs.rmSync(dir, { recursive: true, force: true })
  })
})
