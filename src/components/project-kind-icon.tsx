import { Folder, GitBranch } from "lucide-react"

import { cn } from "@/lib/utils"

export function ProjectKindIcon({
  directory,
  className,
}: {
  directory: boolean
  className?: string
}) {
  const Icon = directory ? Folder : GitBranch
  const label = directory ? "Directory (non-git)" : "Git worktree"
  return (
    <Icon
      role="img"
      aria-label={label}
      className={cn("size-4 shrink-0 text-muted-foreground", className)}
    />
  )
}
