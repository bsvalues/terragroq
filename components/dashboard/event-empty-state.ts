export type EventEmptyStateAction = {
  href: string
  title: string
  description: string
}

export function getEventEmptyStateActions(): EventEmptyStateAction[] {
  return [
    {
      href: "/goal-console",
      title: "Classify a goal",
      description: "Preview whether a goal is safe, blocked, or needs approval.",
    },
    {
      href: "/work-orders",
      title: "Open work orders",
      description: "Create or review governed work before anything executes.",
    },
    {
      href: "/doctrine",
      title: "Review doctrine",
      description: "Confirm the rules that make future audit entries meaningful.",
    },
  ]
}
