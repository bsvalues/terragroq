#!/usr/bin/env node
import {
  canonicalCertificationPortfolioSelectionJson,
  loadCanonicalCertificationPortfolioSelection,
  runCanonicalCertificationPortfolioSelection,
  verifyCanonicalCertificationPortfolioSelection,
} from "./certification-portfolio-selection.mjs"

const command = process.argv[2] ?? "run"

if (command === "plan") {
  process.stdout.write(`${canonicalCertificationPortfolioSelectionJson(loadCanonicalCertificationPortfolioSelection())}\n`)
} else if (command === "verify") {
  process.stdout.write(`${canonicalCertificationPortfolioSelectionJson(verifyCanonicalCertificationPortfolioSelection())}\n`)
} else if (command === "run") {
  process.stdout.write(`${canonicalCertificationPortfolioSelectionJson(runCanonicalCertificationPortfolioSelection())}\n`)
} else {
  throw new Error(`UNKNOWN_CERTIFICATION_PORTFOLIO_SELECTION_COMMAND:${command}`)
}
