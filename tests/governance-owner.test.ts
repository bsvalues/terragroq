import { describe, expect, it } from "vitest"

import { assertOwner, resolveOwnerUserId, type OwnerLookup } from "../lib/governance/owner"
import { DECLARED_PRIMARY_EMAIL, isDeclaredPrimaryEmail } from "../lib/primary-identity"

function lookup(overrides: Partial<OwnerLookup> = {}): OwnerLookup {
  return {
    byEmail: async () => null,
    soleCredentialed: async () => null,
    ...overrides,
  }
}

describe("resolving the owner", () => {
  it("prefers the explicitly configured address", async () => {
    const owner = await resolveOwnerUserId(
      lookup({ byEmail: async () => "owner-1", soleCredentialed: async () => "someone-else" }),
      "Owner@Example.com",
    )
    expect(owner).toBe("owner-1")
  })

  it("normalises the configured address before looking it up", async () => {
    let seen: string | null = null
    await resolveOwnerUserId(lookup({ byEmail: async (email) => { seen = email; return "owner-1" } }), "  Owner@Example.COM  ")
    expect(seen).toBe("owner@example.com")
  })

  it("falls back to the only account that can sign in", async () => {
    expect(await resolveOwnerUserId(lookup({ soleCredentialed: async () => "owner-1" }))).toBe("owner-1")
  })

  it("falls back when the configured address matches no account", async () => {
    // A stale WILLIAMOS_OWNER_EMAIL should not strand a single-operator install.
    const owner = await resolveOwnerUserId(lookup({ soleCredentialed: async () => "owner-1" }), "ghost@example.com")
    expect(owner).toBe("owner-1")
  })

  it("resolves to nobody when several accounts could be the owner", async () => {
    // soleCredentialed returns null unless there is exactly one. Guessing is the failure being avoided.
    expect(await resolveOwnerUserId(lookup())).toBeNull()
  })
})

describe("owner-only authority recording", () => {
  it("admits the owner", () => {
    expect(assertOwner("owner-1", "owner-1")).toEqual({ ok: true })
  })

  it("refuses a different signed-in account", () => {
    const verdict = assertOwner("user-2", "owner-1")
    expect(verdict.ok).toBe(false)
    expect(verdict.failure).toBe("NOT_OWNER")
  })

  it("refuses when the owner cannot be established, rather than admitting the caller", () => {
    // Treating "we could not tell" as "you must be him" is how the route behaved before.
    const verdict = assertOwner("user-2", null)
    expect(verdict.ok).toBe(false)
    expect(verdict.failure).toBe("OWNER_UNRESOLVED")
  })
})

describe("one definition of the owner", () => {
  it("looks the owner up by the same identity device authentication gates on", async () => {
    // The device enrollment, credential and revoke routes all require isDeclaredPrimaryEmail. If this
    // resolved by a different rule the operator could hold write authority while being refused
    // management of his own devices, and nothing would report the contradiction.
    let asked: string | null = null
    await resolveOwnerUserId(lookup({ byEmail: async (email) => { asked = email; return "owner-1" } }))
    expect(asked).not.toBeNull()
    expect(isDeclaredPrimaryEmail(asked!)).toBe(true)
  })

  it("still lets an explicit configuration override the declared identity", async () => {
    let asked: string | null = null
    await resolveOwnerUserId(lookup({ byEmail: async (email) => { asked = email; return "owner-2" } }), "someone@else.test")
    expect(asked).toBe("someone@else.test")
    expect(asked).not.toBe(DECLARED_PRIMARY_EMAIL)
  })
})
