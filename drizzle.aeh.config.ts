import { defineConfig } from "drizzle-kit"

// Generation metadata only. Execution is intentionally disabled: this config contains no URL,
// credentials, or live target. A separately authorized disposable runner must supply its own
// isolated connection contract without modifying this file.
export default defineConfig({
  dialect: "postgresql",
  schema: "./lib/db/schema.ts",
  out: "./migrations/ai-evalops-harness",
  strict: true,
  verbose: true,
})
