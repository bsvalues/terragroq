import { getDoctrine } from "@/app/actions/doctrine"
import { PageHeader } from "@/components/shell/page-header"
import { DoctrineNativeAreaPanel } from "@/components/doctrine/doctrine-native-area-panel"
import { DoctrineView } from "@/components/doctrine/doctrine-view"

export default async function DoctrinePage() {
  const doctrine = await getDoctrine()
  return (
    <>
      <PageHeader
        title="Doctrine"
        description="WilliamOS operating law for principles, safety boundaries, approval gates, evidence rules, and correction paths."
      />
      <div className="p-6 pb-0">
        <DoctrineNativeAreaPanel />
      </div>
      <DoctrineView initial={doctrine} />
    </>
  )
}
