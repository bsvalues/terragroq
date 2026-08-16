import { defineConfig, mergeConfig } from "vitest/config"

import baseConfig from "./vitest.config"

// CI profile for the deterministic suite (.github/workflows/ci.yml).
//
// Every exclusion below is a file that CANNOT pass on a hosted runner by design,
// or is a KNOWN drift already tracked by a work order. Nothing here is excluded
// because it is inconvenient. Remove an entry the moment its reason is gone.
export const CI_EXCLUDED_TEST_FILES: ReadonlyArray<{ file: string; reason: string }> = [
  // ---- host-dependent by design: need live HERMES / Ollama / lab hosts ------
  {
    file: "tests/execution-fabric-hermes-embedding-bakeoff.test.ts",
    reason: "runs the resident HERMES embedding bake-off against a live Ollama endpoint",
  },
  {
    file: "tests/lab-dev-preflight.test.ts",
    reason: "probes the real lab hosts (HERMES/ATLAS ports, remote git identity)",
  },
  // ---- Windows-only by construction (hardcode git-bash / csc.exe paths); portability follow-up --
  {
    file: "tests/execution-fabric-remote-dev-offload-worker.test.ts",
    reason: "hardcodes C:/Program Files/Git/bin/bash.exe and Windows uid semantics; ENOENT on Linux runners",
  },
  {
    file: "tests/execution-fabric-remote-dev-offload-controller.test.ts",
    reason: "compiles a fake ssh.exe with C:/Windows/Microsoft.NET/.../csc.exe; Windows-only",
  },
  // ---- known drift, tracked; unblock by closing the referenced WO ------------
  // (none at present)
]

export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      exclude: [
        "**/node_modules/**",
        ...CI_EXCLUDED_TEST_FILES.map(({ file }) => file),
      ],
      // Several fabric/hermes tests spawn real Node subprocesses (supervisor
      // one-shot cycle, pinned-placement verifier, remote-dev offload worker).
      // They pass in isolation but exceed the 5 s default under parallel load.
      testTimeout: 60_000,
      hookTimeout: 60_000,
    },
  }),
)
