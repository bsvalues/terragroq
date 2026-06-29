import { Gauge } from "lucide-react"
import { getBrainCouncilPredictionCalibration } from "@/components/brain-council/brain-council-prediction-calibration"
import { StatusBadge } from "@/components/status-badge"

const statusValue = {
  pending: "partial",
  verified: "pass",
  error: "fail",
} as const

export function BrainCouncilPredictionCalibrationPanel() {
  const calibration = getBrainCouncilPredictionCalibration()

  return (
    <section className="rounded-2xl border border-border bg-card p-4">
      <div className="flex items-start gap-3">
        <Gauge className="mt-0.5 h-5 w-5 text-primary" aria-hidden />
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-medium">Prediction and calibration viewer</h2>
            <StatusBadge value="neutral" label={calibration.posture.replace(/_/g, " ")} />
          </div>
          <p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted-foreground">
            Predictions are shown with confidence and observed results so Brain Council can learn
            from evidence without automatically changing beliefs or executing verification.
          </p>
        </div>
      </div>

      <div className="mt-4 grid gap-3 xl:grid-cols-3">
        {calibration.predictions.map((prediction) => (
          <article key={prediction.id} className="rounded-lg border border-border bg-background/60 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{prediction.id}</p>
              <StatusBadge value={statusValue[prediction.calibrationStatus]} label={prediction.calibrationStatus} />
            </div>
            <p className="mt-3 text-sm leading-relaxed">{prediction.prediction}</p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              <span className="rounded-full border border-border bg-card px-2 py-1 font-mono text-[10px] text-muted-foreground">
                {prediction.linkedExperiment}
              </span>
              <span className="rounded-full border border-border bg-card px-2 py-1 font-mono text-[10px] text-muted-foreground">
                {Math.round(prediction.confidence * 100)}% confidence
              </span>
            </div>
            <p className="mt-3 text-xs leading-relaxed text-muted-foreground">{prediction.observedResult}</p>
          </article>
        ))}
      </div>
    </section>
  )
}
