import { Loader2 } from "lucide-react"
import { PageHeader } from "@/components/shell/page-header"

export default function ShellLoading() {
  return (
    <>
      <PageHeader
        title="Loading"
        description="Fetching governed runtime state for this route."
      />
      <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        Loading shell view...
      </div>
    </>
  )
}
