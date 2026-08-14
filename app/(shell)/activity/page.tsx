import { getActivity } from "@/lib/operator/activity"
import { WorkbenchActivity } from "@/components/workbench/workbench-activity"

export default async function ActivityPage() {
  const feed = await getActivity()

  return <div className="mx-auto w-full max-w-4xl p-5 md:p-8"><WorkbenchActivity feed={feed} /></div>
}
