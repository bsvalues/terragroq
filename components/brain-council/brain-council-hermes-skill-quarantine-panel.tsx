import { ShieldBan } from "lucide-react"
import {
  getHermesSkillQuarantinePreview,
  getHermesSkillQuarantineSafetySummary,
} from "@/components/brain-council/brain-council-hermes-skill-quarantine"
import { StatusBadge } from "@/components/status-badge"

export function BrainCouncilHermesSkillQuarantinePanel() {
  const preview = getHermesSkillQuarantinePreview()
  const disabledSafetyClaims = getHermesSkillQuarantineSafetySummary(preview.safety)

  return (
    <section className="rounded-2xl border border-warning/30 bg-warning/10 p-4">
      <div className="flex items-start gap-3">
        <ShieldBan className="mt-0.5 h-5 w-5 text-warning" aria-hidden />
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-medium">Hermes skill quarantine preview</h2>
            <StatusBadge value="partial" label={preview.posture.replace(/_/g, " ")} />
          </div>
          <p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted-foreground">
            Skill-like outputs are visible only as quarantined candidates. Disabled safety flags:
            {" "}
            {disabledSafetyClaims}.
          </p>
        </div>
      </div>

      <div className="mt-4 grid gap-3 xl:grid-cols-3">
        {preview.skills.map((skill) => (
          <article key={skill.id} className="rounded-lg border border-warning/30 bg-background/60 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-medium">{skill.label}</h3>
              <StatusBadge value="partial" label={skill.status} />
            </div>
            <p className="mt-1 font-mono text-[10px] text-muted-foreground">{skill.source}</p>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{skill.quarantineReason}</p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {skill.reviewRequired.map((item) => (
                <span key={item} className="rounded-full border border-border bg-card px-2 py-1 font-mono text-[10px] text-muted-foreground">
                  {item}
                </span>
              ))}
            </div>
          </article>
        ))}
      </div>

      <p className="mt-4 rounded-lg border border-border bg-card p-3 text-sm leading-relaxed text-muted-foreground">
        {preview.quarantineRule}
      </p>
    </section>
  )
}
