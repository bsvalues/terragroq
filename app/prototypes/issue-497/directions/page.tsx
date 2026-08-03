import type { Metadata } from "next"
import Link from "next/link"
import styles from "./directions.module.css"

export const metadata: Metadata = {
  title: "TerraFusion Home Visual Directions",
  description: "Founder-review visual direction frames for Issue #497.",
  robots: { index: false, follow: false },
}

type Direction = "field" | "instrument" | "chamber"

type PageProps = {
  searchParams: Promise<{ concept?: string }>
}

const concepts: Array<{ key: Direction; label: string; thesis: string }> = [
  { key: "field", label: "01 Field", thesis: "The county is the interface." },
  { key: "instrument", label: "02 Instrument", thesis: "Evidence becomes civic machinery." },
  { key: "chamber", label: "03 Chamber", thesis: "Decisions reveal spatial consequence." },
]

export default async function VisualDirections({ searchParams }: PageProps) {
  const requested = (await searchParams).concept
  const concept = concepts.some((item) => item.key === requested) ? (requested as Direction) : "field"

  return (
    <main className={`${styles.stage} ${styles[concept]}`}>
      <div className={styles.spatialField} aria-hidden />
      <header className={styles.header}>
        <div className={styles.identity}>
          <span className={styles.axis} aria-hidden />
          <span><strong>TERRAFUSION</strong><small>WILLIAMOS / PRIMARY FIELD</small></span>
        </div>
        <nav aria-label="Visual direction">
          {concepts.map((item) => (
            <Link key={item.key} href={`/prototypes/issue-497/directions?concept=${item.key}`} aria-current={concept === item.key ? "page" : undefined}>
              {item.label}
            </Link>
          ))}
        </nav>
      </header>

      {concept === "field" && <FieldDirection />}
      {concept === "instrument" && <InstrumentDirection />}
      {concept === "chamber" && <ChamberDirection />}

      <footer className={styles.footer}>
        <span>ISSUE 497 / MOCK DATA / FOUNDER REVIEW</span>
        <span>{concepts.find((item) => item.key === concept)?.thesis}</span>
      </footer>
    </main>
  )
}

function FieldDirection() {
  return (
    <section className={styles.fieldComposition} aria-labelledby="field-title">
      <div className={styles.fieldStatus}>
        <span className={styles.coordinate}>47.402 / -120.251</span>
        <span className={styles.blocked}>COMPLETE / VERIFIED</span>
      </div>
      <div className={styles.fieldOutcome}>
        <p>VERIFIED FOUNDATION / ATLAS</p>
        <h1 id="field-title">Atlas foundation<br />is complete and verified.</h1>
        <p className={styles.truth}>The bounded process-host proof is merged. Its authority is consumed.</p>
        <div className={styles.ownerClear}><span aria-hidden />NO ACTION REQUIRED FROM WILLIAM</div>
      </div>
      <ol className={styles.fieldPath} aria-label="Delivery path">
        <li className={styles.complete}><span>01</span><strong>BUILD</strong><small>complete</small></li>
        <li className={styles.complete}><span>02</span><strong>VERIFY</strong><small>complete</small></li>
        <li className={styles.complete}><span>03</span><strong>MERGE</strong><small>landed</small></li>
      </ol>
      <div className={styles.fieldRecent}>
        <span>LANDED / 03</span>
        <strong>Forge valuation engine</strong>
        <strong>Atlas sovereign projection</strong>
        <strong>Governed delivery proof</strong>
      </div>
      <button className={styles.detailTrigger} type="button">TECHNICAL DETAILS +</button>
    </section>
  )
}

function InstrumentDirection() {
  return (
    <section className={styles.instrumentComposition} aria-labelledby="instrument-title">
      <div className={styles.instrumentReadout}>
        <p>PRIMARY OPERATING READOUT</p>
        <h1 id="instrument-title">Atlas is secured.<br />No successor is authorized.</h1>
        <div className={styles.readoutGrid}>
          <span><small>IMPLEMENTATION</small><strong>COMPLETE</strong></span>
          <span><small>DELIVERY</small><strong>MERGED / VERIFIED</strong></span>
          <span><small>OWNER</small><strong>NO ACTION REQUIRED</strong></span>
          <span><small>NEXT</small><strong>NOT AUTHORIZED</strong></span>
        </div>
      </div>
      <div className={styles.instrumentNote}>
        <span>FOUNDATION SECURED</span>
        <strong>Bounded authority consumed.</strong>
        <p>No runtime adoption, deployment, Atlas mutation, or cutover occurred.</p>
      </div>
      <div className={styles.instrumentNext}>
        <span>PROPOSED / NOT YET AUTHORIZED</span>
        <strong>Find parcel → understand → evidence → guidance → action</strong>
      </div>
      <div className={styles.instrumentLedger}>
        <span>RECENTLY SECURED</span>
        <ol><li>01 / Forge canonical</li><li>02 / Atlas validated</li><li>03 / Delivery proven</li></ol>
      </div>
      <button className={styles.detailTrigger} type="button">OPEN EVIDENCE INDEX +</button>
    </section>
  )
}

function ChamberDirection() {
  return (
    <section className={styles.chamberComposition} aria-labelledby="chamber-title">
      <div className={styles.chamberPrompt}>
        <p>PRIMARY DECISION / PRODUCT DIRECTION</p>
        <h1 id="chamber-title">Prove one parcel first,<br />or design for batch?</h1>
        <p>This determines the interaction and evidence model after Atlas. Choosing a direction authorizes neither implementation nor production change.</p>
      </div>
      <div className={styles.recommendation}>
        <span>WILLIAMOS RECOMMENDS</span>
        <strong>Single-parcel first</strong>
        <p>Proves the complete assessor journey with the smallest data and action surface.</p>
      </div>
      <div className={styles.choiceSingle}>
        <span>RECOMMENDED PATH / LOWER EXPOSURE</span>
        <strong>Approve single-parcel first</strong>
        <small>Build the complete find → understand → evidence → guidance → action path.</small>
      </div>
      <div className={styles.choiceBatch}>
        <span>ALTERNATE PATH / BROADER EXPOSURE</span>
        <strong>Request a batch-first plan</strong>
        <small>Pause successor work while performance, data access, and controlled-action risk are redesigned.</small>
      </div>
      <div className={styles.chamberStatus}><span>ATLAS FOUNDATION</span><strong>COMPLETE / VERIFIED / AUTHORITY CONSUMED</strong></div>
      <button className={styles.detailTrigger} type="button">DECISION EVIDENCE +</button>
    </section>
  )
}
