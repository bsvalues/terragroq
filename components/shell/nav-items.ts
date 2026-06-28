import {
  LayoutDashboard,
  BrainCircuit,
  GitBranch,
  ScrollText,
  ClipboardList,
  Library,
  MessageSquare,
  Activity,
  Cpu,
  Crosshair,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react"

export type NavItem = {
  href: string
  label: string
  icon: LucideIcon
  group: NavGroupId
  description: string
}

export const NAV_GROUP_IDS = ["Command", "Governance", "Knowledge", "Operations"] as const

export type NavGroupId = (typeof NAV_GROUP_IDS)[number]

export type NavGroup = {
  id: NavGroupId
  description: string
}

export const navGroups: NavGroup[] = [
  { id: "Command", description: "Start, classify, and route operator work." },
  { id: "Governance", description: "Record decisions, doctrine, and authority posture." },
  { id: "Knowledge", description: "Capture memory and retrieval context." },
  { id: "Operations", description: "Inspect audit history and runtime health." },
]

export const navItems: NavItem[] = [
  {
    href: "/",
    label: "Overview",
    icon: LayoutDashboard,
    group: "Command",
    description: "Current operating state.",
  },
  {
    href: "/goal-console",
    label: "Goal Console",
    icon: Crosshair,
    group: "Command",
    description: "Classify the next objective.",
  },
  {
    href: "/work-orders",
    label: "Work Orders",
    icon: ClipboardList,
    group: "Command",
    description: "Draft scoped governed work.",
  },
  {
    href: "/chat",
    label: "Operator Chat",
    icon: MessageSquare,
    group: "Command",
    description: "Ask with project context.",
  },
  {
    href: "/decisions",
    label: "Decisions",
    icon: GitBranch,
    group: "Governance",
    description: "Capture consequential calls.",
  },
  {
    href: "/doctrine",
    label: "Doctrine",
    icon: ScrollText,
    group: "Governance",
    description: "Define rules and guardrails.",
  },
  {
    href: "/governance",
    label: "Governance Overview",
    icon: ShieldCheck,
    group: "Governance",
    description: "Review authority and locks.",
  },
  {
    href: "/memory",
    label: "Memory",
    icon: BrainCircuit,
    group: "Knowledge",
    description: "Store working facts.",
  },
  {
    href: "/corpus",
    label: "Corpus",
    icon: Library,
    group: "Knowledge",
    description: "Index source documents.",
  },
  {
    href: "/audit",
    label: "Audit Log",
    icon: Activity,
    group: "Operations",
    description: "Inspect recorded events.",
  },
  {
    href: "/runtime",
    label: "Runtime",
    icon: Cpu,
    group: "Operations",
    description: "Check system health.",
  },
]
