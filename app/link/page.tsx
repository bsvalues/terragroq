import { LinkDeviceForm } from "@/components/auth/link-device-form"

export const dynamic = "force-dynamic"

/**
 * Where a new device signs itself in. Deliberately unauthenticated and deliberately plain: this is
 * the page a phone reaches when it has no session, no passkey and nothing installed.
 */
export default function LinkPage() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-sm flex-col justify-center gap-6 p-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-xl font-semibold tracking-tight">Add this device</h1>
        <p className="text-sm text-muted-foreground">
          On a device that is already signed in, open Sign-in devices and choose Show a code. Type it
          here within two minutes.
        </p>
      </header>
      <LinkDeviceForm />
    </main>
  )
}
