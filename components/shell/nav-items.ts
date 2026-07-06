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
  GitCommitHorizontal,
  GraduationCap,
  Bot,
  ShieldCheck,
  Database,
  type LucideIcon,
} from "lucide-react"

export type NavItem = {
  href: string
  label: string
  icon: LucideIcon
  group: NavGroupId
  description: string
}

export const NAV_GROUP_IDS = ["Home", "Work", "Authority", "Council", "Systems"] as const

export type NavGroupId = (typeof NAV_GROUP_IDS)[number]

export type NavGroup = {
  id: NavGroupId
  tier: "Primary" | "Supporting"
  description: string
}

export const navGroups: NavGroup[] = [
  { id: "Home", tier: "Primary", description: "Primary briefing and next move." },
  { id: "Work", tier: "Primary", description: "Work Orders, Evidence, Projects, and Systems." },
  { id: "Authority", tier: "Primary", description: "Authority gates, decisions, and operating doctrine." },
  { id: "Council", tier: "Supporting", description: "Advisory, Memory, Forge, and Hermes boundaries." },
  { id: "Systems", tier: "Supporting", description: "Reference, trace, corpus, and command conversation." },
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
    href: "/runtime",
    label: "Systems",
    icon: Cpu,
    group: "Work",
    description: "Check readiness and health.",
  },
  {
    href: "/governance",
    label: "Authority",
    icon: ShieldCheck,
    group: "Authority",
    description: "Review gates and boundaries.",
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
    href: "/memory",
    label: "Memory",
    icon: Database,
    group: "Council",
    description: "Preserve durable context.",
  },
  {
    href: "/brain-council",
    label: "Council",
    icon: BrainCircuit,
    group: "Council",
    description: "Review advisory reasoning.",
  },
  {
    href: "/agent-forge",
    label: "Forge",
    icon: Hammer,
    group: "Council",
    description: "Prepare capabilities.",
  },
  {
    href: "/hermes",
    label: "Hermes",
    icon: Bot,
    group: "Council",
    description: "Review worker boundaries.",
  },
  {
    href: "/goal-console",
    label: "Next Objective",
    icon: Crosshair,
    group: "Systems",
    description: "Classify governed intent.",
  },
  {
    href: "/trace",
    label: "Trace",
    icon: GitCommitHorizontal,
    group: "Systems",
    description: "Review reasoning records.",
  },
  {
    href: "/academy",
    label: "Academy",
    icon: GraduationCap,
    group: "Systems",
    description: "Learn WilliamOS operation.",
  },
  {
    href: "/corpus",
    label: "Corpus",
    icon: Library,
    group: "Systems",
    description: "Review source body.",
  },
  {
    href: "/chat",
    label: "Operator Chat",
    icon: MessageSquare,
    group: "Systems",
    description: "Command conversation.",
  },
]
