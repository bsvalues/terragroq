import { defineConfig } from "vitest/config"
import tsconfigPaths from "vite-tsconfig-paths"

// Governance test harness (WO-013). Tests target the PURE governance modules so
// they run without a database or network — fully deterministic and reproducible.
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
})
