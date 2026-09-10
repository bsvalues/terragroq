import { DeviceBootstrap } from "@/components/device/device-bootstrap"
import { headers } from "next/headers"
import { redirect } from "next/navigation"

export const dynamic = "force-dynamic"

export default async function DeviceBootstrapPage() {
  // The HTTPS proxy strips every inbound copy of this header and sets it only after the presented
  // client certificate verifies against the WilliamOS device CA. A pre-provisioned Cockpit such as
  // hermes-desktop must therefore enter the existing certificate-session route instead of being
  // sent back through passkey/password recovery. Certificate-less native clients retain the
  // Ed25519 bootstrap path below and can be enrolled only from an authenticated owner session.
  const verifiedDevice = (await headers()).get("x-williamos-device-cert")
  if (verifiedDevice) redirect("/api/device-cert/session?next=/")
  return <DeviceBootstrap />
}
