import { describe, expect, it, vi } from "vitest"

import { readHelloApplicationProjectHead } from "@/lib/hello-application/runtime-truth"

describe("Hello Application runtime truth", () => {
  it("reads the canonical workspace HEAD with a bounded shell-free git process", async () => {
    const run = vi.fn().mockResolvedValue({ stdout: `${"c".repeat(40)}\n`, stderr: "" })

    await expect(readHelloApplicationProjectHead("C:/WilliamOS/hello-application", run)).resolves.toBe("c".repeat(40))

    expect(run).toHaveBeenCalledWith(
      "git",
      ["rev-parse", "--verify", "HEAD^{commit}"],
      expect.objectContaining({
        cwd: "C:/WilliamOS/hello-application",
        encoding: "utf8",
        maxBuffer: 65_536,
        shell: false,
        timeout: 5_000,
        windowsHide: true,
      }),
    )
  })

  it.each(["", "development", "abc123", `${"d".repeat(40)} extra`])("rejects unproven git output %j", async (stdout) => {
    const run = vi.fn().mockResolvedValue({ stdout, stderr: "" })

    await expect(readHelloApplicationProjectHead("C:/WilliamOS/hello-application", run))
      .rejects.toThrow("HELLO_APPLICATION_PROJECT_HEAD_INVALID")
  })
})
