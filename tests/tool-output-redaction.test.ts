import { describe, expect, it } from "vitest"

import { createToolOutputRedactor, redactToolOutputText } from "@/lib/loom/output-redaction"

describe("developer tool output redaction", () => {
  it("redacts credential URLs, assignments, provider tokens and private keys while preserving safe diagnostics", () => {
    const unsafe = [
      "connecting postgresql://owner:opaque-db-password@db.example.test/app",
      "DATABASE_URL=postgresql://owner:second-password@db.example.test/app",
      "AZURE_STORAGE_CONNECTION_STRING=DefaultEndpointsProtocol=https;AccountName=owner;AccountKey=QWxhZGRpbjpPcGVuU2VzYW1l;EndpointSuffix=core.windows.net",
      "SQL_CONNECTION_STRING=Data Source=db.example.test;Initial Catalog=app;User ID=owner;Pwd=U3BhY2VkQ3JlZGVudGlhbA==",
      "Authorization: Bearer opaque-bearer-token-value",
      "github_pat_abcdefghijklmnopqrstuvwxyz123456",
      "-----BEGIN PRIVATE KEY-----\nprivate-key-body\n-----END PRIVATE KEY-----",
      "tests failed after 18 assertions",
    ].join("\n")

    const redacted = redactToolOutputText(unsafe)

    expect(redacted).not.toMatch(/opaque-db-password|second-password|opaque-bearer-token-value|github_pat_|private-key-body|QWxhZGRpbjpPcGVuU2VzYW1l|U3BhY2VkQ3JlZGVudGlhbA|AccountKey|Pwd=/)
    expect(redacted).toContain("[REDACTED]")
    expect(redacted).toContain("tests failed after 18 assertions")
  })

  it("holds incomplete lines so secrets split across process chunks never reach the browser", () => {
    const redactor = createToolOutputRedactor()

    expect(redactor.push("DATABASE_URL=postgresql://owner:split-pa")).toBe("")
    expect(redactor.push("ssword@db.example.test/app\nsafe output\n")).toBe("DATABASE_URL=[REDACTED]\nsafe output\n")
    expect(redactor.end()).toBe("")
  })

  it("suppresses a multiline private-key body split across chunks", () => {
    const redactor = createToolOutputRedactor()

    expect(redactor.push("-----BEGIN PRIVATE KEY-----\nprivate-")).toBe("[REDACTED_PRIVATE_KEY]\n")
    expect(redactor.push("key-body\n-----END PRIVATE KEY-----\nafter\n")).toBe("after\n")
    expect(redactor.end()).toBe("")
  })
})
