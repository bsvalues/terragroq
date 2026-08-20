import { redirect } from "next/navigation"

/** One canonical Environment root. The retired demo URL never mounts its old client-only facade. */
export default async function EnvironmentPage() {
  redirect("/environment")
}
