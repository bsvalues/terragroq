import { passkeyResolution } from "@/lib/auth"
import { passkeyUnavailableCopy } from "@/lib/auth-passkey"
import { PasskeyDevices } from "@/components/auth/passkey-devices"
import { DeviceOnboardingPanel } from "@/components/auth/device-onboarding-panel"
import { DeviceLinkPanel } from "@/components/auth/device-link-panel"
import { deviceLinkEntryUrl } from "@/lib/device-link"

export const dynamic = "force-dynamic"

/**
 * Contextual detail route, reached from the account menu — not a new top-level destination.
 * Sign-in devices are account machinery, not part of the four Workbench view modes.
 */
export default function DevicesPage() {
  const available = passkeyResolution.available
  const origin = available ? passkeyResolution.relyingParty.origin : null

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-5 py-8 md:px-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold tracking-tight">Sign-in devices</h1>
        <p className="text-sm text-muted-foreground">
          Devices that can unlock WilliamOS with Windows Hello, Touch ID or Face ID.
        </p>
      </header>

      <PasskeyDevices available={available} unavailableReason={passkeyUnavailableCopy(passkeyResolution)} />

      <DeviceLinkPanel entryUrl={deviceLinkEntryUrl(origin ?? "")} />

      {origin ? <DeviceOnboardingPanel origin={origin} /> : null}
    </div>
  )
}
