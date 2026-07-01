import Link from "next/link"
import { CircleAlert } from "lucide-react"
import { Button } from "@/components/ui/button"

export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-xl rounded-lg border border-border bg-card p-6">
        <div className="flex items-start gap-3">
          <CircleAlert className="mt-0.5 h-5 w-5 text-warning" aria-hidden />
          <div className="flex flex-col gap-3">
            <h1 className="text-lg font-semibold">Page not found</h1>
            <p className="text-sm text-muted-foreground">
              The route you requested does not exist in WilliamOS.
            </p>
            <Button asChild className="w-fit">
              <Link href="/">Return Home</Link>
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
