export function basename(path: string): string {
  const parts = path.split("/").filter(Boolean)
  return parts[parts.length - 1] ?? path
}

export function middleTruncatePath(path: string, head = 3, tail = 3): string {
  const parts = path.split("/").filter(Boolean)
  if (parts.length <= head + tail) return path
  return `/${parts.slice(0, head).join("/")}/…/${parts.slice(-tail).join("/")}`
}

export function projectDisplayName(name: string, worktree: string): string {
  if (name) return name
  if (!worktree || worktree === "/") return "global"
  return basename(worktree)
}

export function sessionProjectName(projectName: string, directory: string): string {
  if (!projectName || projectName === "/") return basename(directory) || "global"
  if (projectName.startsWith("/")) return basename(projectName)
  return projectName
}
