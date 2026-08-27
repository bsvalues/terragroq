import {
  Cpu,
  LayoutDashboard,
  type LucideIcon,
} from "lucide-react"

export type NavItem = {
  href: string
  label: string
  icon: LucideIcon
  group: NavGroupId
  description: string
}

export const NAV_GROUP_IDS = ["Cockpit"] as const
export type NavGroupId = (typeof NAV_GROUP_IDS)[number]

export type NavGroup = {
  id: NavGroupId
  tier: "Primary"
  description: string
}

export const navGroups: NavGroup[] = [
  {
    id: "Cockpit",
    tier: "Primary",
    description: "Home, durable projects, recorded activity, and system truth.",
  },
]

export const navItems: NavItem[] = [
  {
    href: "/",
    label: "Home",
    icon: LayoutDashboard,
    group: "Cockpit",
    description: "Primary operator briefing.",
  },
  {
    href: "/system",
    label: "System",
    icon: Cpu,
    group: "Cockpit",
    description: "Truthful system signals.",
  },
]
