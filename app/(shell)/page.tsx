import { getPrimaryHomeReadModel } from "@/app/(shell)/primary-home-query"
import { PrimaryHome } from "@/components/primary-home/primary-home"

export default async function PrimaryHomePage() {
  const home = await getPrimaryHomeReadModel()

  return <PrimaryHome model={home.model} decisionRequest={home.decisionRequest} />
}
