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
  type LucideIcon,
} from "lucide-react"

export type NavItem = {
  href: string
  label: string
  icon: LucideIcon
  group: string
}

export const navItems: NavItem[] = [
  { href: "/", label: "Overview", icon: LayoutDashboard, group: "Command" },
  { href: "/goal-console", label: "Goal Console", icon: Crosshair, group: "Command" },
  { href: "/chat", label: "Operator Chat", icon: MessageSquare, group: "Command" },
  { href: "/memory", label: "Memory", icon: BrainCircuit, group: "Registers" },
  { href: "/decisions", label: "Decisions", icon: GitBranch, group: "Registers" },
  { href: "/doctrine", label: "Doctrine", icon: ScrollText, group: "Registers" },
  { href: "/work-orders", label: "Work Orders", icon: ClipboardList, group: "Registers" },
  { href: "/corpus", label: "Corpus", icon: Library, group: "Knowledge" },
  { href: "/audit", label: "Audit Log", icon: Activity, group: "Knowledge" },
  { href: "/runtime", label: "Runtime", icon: Cpu, group: "Knowledge" },
]
