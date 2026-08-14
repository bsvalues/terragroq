import { getActivity } from "@/lib/operator/activity"
import { ActivityView } from "@/components/activity/activity-view"
import { PageHeader } from "@/components/shell/page-header"

export default async function ActivityPage() {
  const feed = await getActivity()

  return (
    <>
      <PageHeader
        title="Activity"
        description="What WilliamOS and its agents have done — meaningful events, most recent first."
      />
      <div className="p-6">
        <ActivityView feed={feed} />
      </div>
    </>
  )
}
