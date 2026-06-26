import { getDoctrine } from "@/app/actions/doctrine"
import { PageHeader } from "@/components/shell/page-header"
import { DoctrineView } from "@/components/doctrine/doctrine-view"

export default async function DoctrinePage() {
  const doctrine = await getDoctrine()
  return (
    <>
      <PageHeader
        title="Doctrine"
        description="Machine-readable operating rules with allowed, forbidden, and requires-approval clauses. Active doctrine is injected into the agent and enforced in Operator Chat."
      />
      <DoctrineView initial={doctrine} />
    </>
  )
}
