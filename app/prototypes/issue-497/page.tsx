import type { Metadata } from "next"
import Link from "next/link"
import {
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleDot,
  FileCheck2,
  LockKeyhole,
  MapPinned,
  ShieldCheck,
} from "lucide-react"
import styles from "./prototype.module.css"

export const metadata: Metadata = {
  title: "WilliamOS Primary Home Prototype",
  description: "Issue #497 founder-review prototype using mock data only.",
  robots: { index: false, follow: false },
}

const recentOutcomes = [
  {
    title: "Forge became the canonical valuation engine.",
    detail: "One governed valuation path now carries the product forward.",
  },
  {
    title: "Atlas local sovereign projection passed validation.",
    detail: "Parcel projection was proven without adding a production dependency.",
  },
  {
    title: "WilliamOS governed delivery was proven.",
    detail: "Bounded work can move from outcome through evidence and verified delivery.",
  },
]

type PrototypePageProps = {
  searchParams: Promise<{ scenario?: string }>
}

export default async function PrimaryHomePrototype({ searchParams }: PrototypePageProps) {
  const scenario = (await searchParams).scenario
  const decisionMode = scenario === "decision"

  return (
    <main className={styles.canvas}>
      <div className={styles.shell}>
        <header className={styles.masthead}>
          <div className={styles.brand}>
            <span className={styles.brandMark}>TF</span>
            <span>
              <strong>TerraFusion</strong>
              <small>WilliamOS · Primary Home</small>
            </span>
          </div>

          <div className={styles.headerRight}>
            <span className={styles.privateSignal}>
              <LockKeyhole aria-hidden />
              Primary operator
            </span>
            <nav className={styles.scenarioSwitch} aria-label="Prototype state">
              <Link
                href="/prototypes/issue-497"
                aria-current={decisionMode ? undefined : "page"}
              >
                Operating
              </Link>
              <Link
                href="/prototypes/issue-497?scenario=decision"
                aria-current={decisionMode ? "page" : undefined}
              >
                Decision
              </Link>
            </nav>
          </div>
        </header>

        <section className={styles.briefing} aria-labelledby="briefing-title">
          <div>
            <p className={styles.kicker}>Sunday briefing</p>
            <h1 id="briefing-title">TerraFusion is moving forward.</h1>
          </div>
          <p>
            {decisionMode
              ? "Atlas implementation is complete. One product-direction decision is ready for you below."
              : "Atlas implementation is complete. One bounded CI repair is holding the merge; nothing needs your decision."}
          </p>
        </section>

        <section className={styles.workingNow} aria-labelledby="working-title">
          <div className={styles.mapBackdrop} aria-hidden />
          <div className={styles.mapShade} aria-hidden />
          <div className={styles.workingStory}>
            <p className={styles.sectionLabel}>Working now</p>
            <div className={styles.healthLine}>
              <span className={styles.healthPulse} aria-hidden />
              Execution is healthy · merge is held
            </div>
            <h2 id="working-title">Atlas process-host implementation is complete.</h2>
            <p>
              Codex finished the bounded host in PR #1393. Required checks are waiting
              on a narrow CI governance repair before Atlas can merge.
            </p>
            <div className={styles.actorLine}>
              <ShieldCheck aria-hidden />
              WilliamOS is coordinating the repair and will re-verify the exact head.
            </div>
          </div>

          <ol className={styles.executionPath} aria-label="Atlas execution path">
            <li className={styles.doneStep}>
              <Check aria-hidden />
              <span><strong>Build complete</strong><small>Implementation and focused proof landed</small></span>
            </li>
            <li className={styles.currentStep}>
              <CircleDot aria-hidden />
              <span><strong>Repair CI governance</strong><small>Current bounded action</small></span>
            </li>
            <li>
              <ArrowRight aria-hidden />
              <span><strong>Merge and verify</strong><small>Next automatic step</small></span>
            </li>
          </ol>
        </section>

        {decisionMode ? <DecisionAttention /> : <ClearAttention />}

        <section className={styles.nextOutcome} aria-labelledby="next-title">
          <div className={styles.nextIcon}><MapPinned aria-hidden /></div>
          <div>
            <p className={styles.sectionLabel}>Next</p>
            <h2 id="next-title">Prove one complete assessor workflow.</h2>
          </div>
          <p>
            After Atlas merges: find a parcel, understand it, inspect evidence,
            receive grounded guidance, and take action.
          </p>
          <ArrowRight className={styles.nextArrow} aria-hidden />
        </section>

        <section className={styles.completed} aria-labelledby="completed-title">
          <div className={styles.completedHeading}>
            <div>
              <p className={styles.sectionLabel}>Recently completed</p>
              <h2 id="completed-title">Meaningful outcomes, not mechanics.</h2>
            </div>
            <FileCheck2 aria-hidden />
          </div>
          <ol>
            {recentOutcomes.map((outcome) => (
              <li key={outcome.title}>
                <CheckCircle2 aria-hidden />
                <span><strong>{outcome.title}</strong><small>{outcome.detail}</small></span>
              </li>
            ))}
          </ol>
        </section>

        <details className={styles.technicalDetails}>
          <summary>
            <span>Technical details</span>
            <span className={styles.technicalHint}>Evidence, identifiers, checks, and runtime context</span>
            <ChevronDown aria-hidden />
          </summary>
          <div className={styles.technicalGrid}>
            <dl>
              <div><dt>Delivery</dt><dd>PR #1393</dd></div>
              <div><dt>State</dt><dd>Implementation complete · CI held</dd></div>
              <div><dt>Control</dt><dd>Bounded governance repair only</dd></div>
            </dl>
            <dl>
              <div><dt>Evidence</dt><dd>Issue #497 scenario · PR #1393 narrative</dd></div>
              <div><dt>Authority</dt><dd>Issue #497 · prototype only</dd></div>
              <div><dt>Source</dt><dd>Static mock data · not independently refreshed</dd></div>
            </dl>
          </div>
        </details>

        <footer className={styles.footer}>
          Prototype for founder review · No live data · No production behavior
        </footer>
      </div>
    </main>
  )
}

function ClearAttention() {
  return (
    <section className={styles.clearAttention} aria-labelledby="attention-title">
      <CheckCircle2 aria-hidden />
      <div>
        <p className={styles.sectionLabel}>Your attention</p>
        <h2 id="attention-title">Nothing requires your decision right now.</h2>
      </div>
      <p>Safe execution is continuing inside the approved boundary.</p>
    </section>
  )
}

function DecisionAttention() {
  return (
    <section className={styles.decisionAttention} aria-labelledby="attention-title">
      <div className={styles.decisionLead}>
        <p className={styles.sectionLabel}>Your attention · Product direction</p>
        <h2 id="attention-title">
          Should the first assessor workflow prove one parcel at a time before
          TerraFusion adds batch operations?
        </h2>
        <p>
          This choice is needed now because it determines the interaction and evidence
          model for the outcome that follows Atlas.
        </p>
      </div>

      <div className={styles.recommendation}>
        <span>Recommendation</span>
        <strong>Approve the single-parcel workflow first.</strong>
        <p>It proves the complete assessor journey with the smallest safety and data surface.</p>
      </div>

      <div className={styles.consequences}>
        <div>
          <strong>If approved</strong>
          <p>Build find → understand → evidence → guidance → action for one parcel.</p>
        </div>
        <div>
          <strong>If declined</strong>
          <p>Pause this outcome and return with a batch-first product plan for review.</p>
        </div>
        <div>
          <strong>Material consequence</strong>
          <p>Batch-first expands performance, data-access, and controlled-action risk earlier.</p>
        </div>
      </div>

      <details className={styles.decisionEvidence}>
        <summary>Why this recommendation</summary>
        <p>
          A single-parcel proof completes the assessor journey before batch scale adds
          performance, broader data access, and controlled-action complexity.
        </p>
      </details>

      <div className={styles.decisionActions} aria-label="Prototype decision actions">
        <button type="button" className={styles.approveButton}>Approve recommendation</button>
        <button type="button" className={styles.declineButton}>Decline</button>
        <small>Prototype only. These controls do not submit or mutate authority.</small>
      </div>
    </section>
  )
}
