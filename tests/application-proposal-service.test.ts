import { describe, expect, it } from "vitest"

import { createProposalEngine } from "@/lib/applications/proposal-engine.mjs"
import {
  HELLO_APPLICATION_ALLOWED_PATHS,
  governedPrompt as helloGovernedPrompt,
} from "@/lib/hello-application/proposal-service.mjs"

describe("application proposal engine compatibility", () => {
  it("builds literal manifest-bound prompts while preserving the Hello delegate", () => {
    const engine = createProposalEngine({
      applicationId: "focus-board",
      displayName: "Focus Board",
      allowedPaths: ["web/page.html", "assets/theme.css", "client/main.js"],
      validationPaths: ["web/page.html", "assets/theme.css", "client/main.js", "test/application.test.mjs"],
      validationCommand: "node --test test/application.test.mjs",
      namespace: "application-proposals/focus-board",
      receiptSchemaVersion: 4,
    })

    expect(engine.allowedPaths).toEqual(["web/page.html", "assets/theme.css", "client/main.js"])
    expect(engine.governedPrompt("Add a reset button")).toContain("Focus Board (focus-board)")
    expect(engine.governedPrompt("Add a reset button")).toContain("web/page.html, assets/theme.css, client/main.js")
    expect(engine.governedPrompt("Add a reset button")).toContain("node --test test/application.test.mjs")

    expect(HELLO_APPLICATION_ALLOWED_PATHS).toEqual([
      "examples/hello-application/src/app.js",
      "examples/hello-application/src/index.html",
      "examples/hello-application/src/styles.css",
    ])
    expect(helloGovernedPrompt("Change the greeting")).toContain("isolated Hello Application workspace")
  })
})
