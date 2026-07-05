import { AcademyWikiPanel } from "@/components/academy/academy-wiki-panel"
import { PageHeader } from "@/components/shell/page-header"

export default function AcademyPage() {
  return (
    <>
      <PageHeader
        title="Academy / Wiki"
        description="Static WilliamOS learning and reference layer for operating doctrine, concepts, glossary, safety boundaries, and Codex operator guidance. Read-only; no training runtime or automation."
      />
      <div className="flex flex-col gap-6 p-6">
        <AcademyWikiPanel />
      </div>
    </>
  )
}
