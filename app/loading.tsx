import { Loader2 } from "lucide-react"

export default function RootLoading() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        Loading WilliamOS...
      </div>
    </div>
  )
}
