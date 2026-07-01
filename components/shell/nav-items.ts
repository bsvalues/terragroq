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
  FolderKanban,
  Hammer,
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

export const NAV_GROUP_IDS = ["Home", "Work", "Council", "Authority", "Systems"] as const

export type NavGroupId = (typeof NAV_GROUP_IDS)[number]

export type NavGroup = {
  id: NavGroupId
  description: string
}

export const navGroups: NavGroup[] = [
  { id: "Home", description: "Primary briefing, command conversation, and next move." },
  { id: "Work", description: "Projects, objectives, Work Orders, and Evidence." },
  { id: "Council", description: "Brain Council, Memory, and Corpus context." },
  { id: "Authority", description: "Decisions, Doctrine, Governance, and approval gates." },
  { id: "Systems", description: "Systems, Readiness, production health, and safe states." },
]

export const navItems: NavItem[] = [
  {
    href: "/",
    label: "Home",
    icon: LayoutDashboard,
    group: "Home",
    description: "Primary Operator briefing.",
  },
  {
    href: "/chat",
    label: "Operator Chat",
    icon: MessageSquare,
    group: "Home",
    description: "Command conversation.",
  },
  {
    href: "/goal-console",
    label: "Next Objective",
    icon: Crosshair,
    group: "Work",
    description: "Classify governed intent.",
  },
  {
    href: "/work-orders",
    label: "Work Orders",
    icon: ClipboardList,
    group: "Work",
    description: "Control governed mutation.",
  },
  {
    href: "/audit",
    label: "Evidence",
    icon: Activity,
    group: "Work",
    description: "Inspect proof records.",
  },
  {
    href: "/projects",
    label: "Projects",
    icon: FolderKanban,
    group: "Work",
    description: "Review systems under command.",
  },
  {
    href: "/agent-forge",
    label: "Agent Forge",
    icon: Hammer,
    group: "Work",
    description: "Prepare capabilities.",
  },
  {
    href: "/brain-council",
    label: "Brain Council",
    icon: BrainCircuit,
    group: "Council",
    description: "Review advisory reasoning.",
  },
  {
    href: "/memory",
    label: "Memory",
    icon: BrainCircuit,
    group: "Council",
    description: "Preserve durable context.",
  },
  {
    href: "/corpus",
    label: "Corpus",
    icon: Library,
    group: "Council",
    description: "Review source body.",
  },
  {
    href: "/decisions",
    label: "Decisions",
    icon: GitBranch,
    group: "Authority",
    description: "Record authority calls.",
  },
  {
    href: "/doctrine",
    label: "Doctrine",
    icon: ScrollText,
    group: "Authority",
    description: "Read operating law.",
  },
  {
    href: "/governance",
    label: "Governance",
    icon: ShieldCheck,
    group: "Authority",
    description: "Review gates and boundaries.",
  },
  {
    href: "/runtime",
    label: "Systems",
    icon: Cpu,
    group: "Systems",
    description: "Check readiness and health.",
  },
]
