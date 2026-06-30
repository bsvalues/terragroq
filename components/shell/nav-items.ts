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
  { id: "Home", description: "Briefing, questions, and the next move." },
  { id: "Work", description: "Projects, goals, work orders, and evidence." },
  { id: "Council", description: "Reasoning, memory, and knowledge context." },
  { id: "Authority", description: "Decisions, doctrine, and governance gates." },
  { id: "Systems", description: "Runtime, readiness, and operational posture." },
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
    label: "Ask WilliamOS",
    icon: MessageSquare,
    group: "Home",
    description: "Ask with project context.",
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
    description: "Control scoped mutation.",
  },
  {
    href: "/audit",
    label: "Evidence",
    icon: Activity,
    group: "Work",
    description: "Inspect proof trails.",
  },
  {
    href: "/projects",
    label: "Projects",
    icon: FolderKanban,
    group: "Work",
    description: "Track project systems.",
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
    description: "Review source material.",
  },
  {
    href: "/decisions",
    label: "Decisions",
    icon: GitBranch,
    group: "Authority",
    description: "Record consequential calls.",
  },
  {
    href: "/doctrine",
    label: "Doctrine",
    icon: ScrollText,
    group: "Authority",
    description: "Define rules and guardrails.",
  },
  {
    href: "/governance",
    label: "Governance",
    icon: ShieldCheck,
    group: "Authority",
    description: "Review gates and locks.",
  },
  {
    href: "/runtime",
    label: "Systems",
    icon: Cpu,
    group: "Systems",
    description: "Check operational posture.",
  },
]
