export type ResearchModeSummaryItem = {
  label: string
  value: string
  href: string
}

export type ResearchModeHomeSummary = {
  posture: "RESEARCH_MODE_HOME_SUMMARY_READ_ONLY"
  items: ResearchModeSummaryItem[]
  readinessRegressionStatus: "PASS"
  hermesStatus: "preview-only"
  safety: {
    startsResearch: false
    runsEval: false
    activatesHermes: false
    writesData: false
  }
}

export function getResearchModeHomeSummary(): ResearchModeHomeSummary {
  return {
    posture: "RESEARCH_MODE_HOME_SUMMARY_READ_ONLY",
    items: [
      { label: "Open experiments", value: "3", href: "/brain-council" },
      { label: "Open assumptions", value: "4", href: "/brain-council" },
      { label: "Open unknowns", value: "3", href: "/brain-council" },
      { label: "Open contradictions", value: "2", href: "/brain-council" },
      { label: "Cognitive debt", value: "review needed", href: "/brain-council" },
    ],
    readinessRegressionStatus: "PASS",
    hermesStatus: "preview-only",
    safety: {
      startsResearch: false,
      runsEval: false,
      activatesHermes: false,
      writesData: false,
    },
  }
}
