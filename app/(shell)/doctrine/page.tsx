import { getDoctrine } from "@/app/actions/doctrine"
import { PageHeader } from "@/components/shell/page-header"
import { DoctrineView } from "@/components/doctrine/doctrine-view"

export default async function DoctrinePage() {
  const doctrine = await getDoctrine()
  return (
    <>
      <PageHeader
        title="Doctrine"
        description="The operating principles, policies, and guardrails that govern behavior. Active doctrine steers the AI in Operator Chat."
      />
      <DoctrineView initial={doctrine} />
    </>
  )
}
