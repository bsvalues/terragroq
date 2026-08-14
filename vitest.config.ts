import { defineConfig } from "vitest/config"
import tsconfigPaths from "vite-tsconfig-paths"
import react from "@vitejs/plugin-react"

const executableModuleTestCompatibility = {
  name: "executable-module-test-compatibility",
  enforce: "pre" as const,
  transform(source: string, id: string) {
    if (!id.endsWith(".mjs") || !source.startsWith("#!")) return null
    return source.replace(/^#![^\r\n]*(?:\r?\n|$)/, "")
  },
}

// Governance test harness (WO-013). Tests target the PURE governance modules so
// they run without a database or network — fully deterministic and reproducible.
export default defineConfig({
  plugins: [executableModuleTestCompatibility, react(), tsconfigPaths()],
  test: {
    include: ["tests/**/*.test.{ts,tsx}"],
    environment: "node",
  },
})
