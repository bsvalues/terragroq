import { describe, expect, it } from "vitest"

import { addedLines } from "../scripts/runtime-operator/native-adapters.mjs"

/**
 * The secret wall refused WO-0029 before any of its work could be judged. The cause was not a secret:
 * `components/intent/universal-intent.tsx` contains `const token = (requestRef.current += 1)`, an
 * ordinary React request counter, and the wall read whole file contents rather than the patch. A worker
 * was therefore accused of committing a secret it had not written, in a line it was not allowed to
 * change, and no patch to that file could ever pass.
 */
describe("what the patch adds", () => {
  const patch = [
    "diff --git a/x.ts b/x.ts",
    "--- a/x.ts",
    "+++ b/x.ts",
    "@@ -1,2 +1,3 @@",
    " const kept = 1",
    "-const removed = 2",
    "+const introduced = 3",
  ].join("\n")

  it("reads only introduced lines, not context, removals, or the file header", () => {
    expect(addedLines(patch)).toEqual(["const introduced = 3"])
  })

  it("survives an empty or missing patch", () => {
    expect(addedLines("")).toEqual([])
    expect(addedLines(undefined)).toEqual([])
  })

  it("handles CRLF patches, which is what this host produces", () => {
    expect(addedLines("+++ b/x.ts\r\n+added line\r\n context\r\n")).toEqual(["added line"])
  })
})

describe("the secret pattern", () => {
  // Read from the module so the test tracks the shipped rule rather than a copy of it.
  const source = new URL("../scripts/runtime-operator/native-adapters.mjs", import.meta.url)
  const declaration = readSecretField()

  function readSecretField(): RegExp {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const text = require("node:fs").readFileSync(source, "utf8") as string
    const line = text.split("\n").find((candidate) => candidate.startsWith("const SECRET_FIELD"))
    if (!line) throw new Error("SECRET_FIELD not found")
    // eslint-disable-next-line no-eval
    return eval(line.replace("const SECRET_FIELD = ", "")) as RegExp
  }

  it("does not read an ordinary identifier assignment as a credential", () => {
    expect(declaration.test("const token = (requestRef.current += 1)")).toBe(false)
    expect(declaration.test("const tokenCount = countTokens(input)")).toBe(false)
    expect(declaration.test("let password = derivePassword(user)")).toBe(false)
  })

  it("still refuses a quoted credential literal", () => {
    expect(declaration.test('password: "hunter2-hunter2-hunter2"')).toBe(true)
    expect(declaration.test("api_key = 'sk-abcdefghijklmnopqrstuvwx'")).toBe(true)
  })

  it("still refuses the unambiguous shapes that need no assignment at all", () => {
    expect(declaration.test("postgres://user:pw@host/db")).toBe(true)
    expect(declaration.test("ghp_abcdefghijklmnopqrstuvwxyz12")).toBe(true)
    expect(declaration.test("-----BEGIN RSA PRIVATE KEY-----")).toBe(true)
  })
})
