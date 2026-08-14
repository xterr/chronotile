const SEPARATORS = /[\\/]+/

export function basename(path: string): string {
  const parts = path.split(SEPARATORS).filter(Boolean)
  return parts[parts.length - 1] ?? path
}

export function middleTruncatePath(path: string, head = 3, tail = 3): string {
  const parts = path.split(SEPARATORS).filter(Boolean)
  if (parts.length <= head + tail) return path
  const sep = path.includes("\\") ? "\\" : "/"
  const prefix = path.startsWith("/") ? "/" : ""
  return `${prefix}${parts.slice(0, head).join(sep)}${sep}…${sep}${parts.slice(-tail).join(sep)}`
}

export function projectDisplayName(name: string, worktree: string): string {
  if (name) return name
  if (!worktree || worktree === "/") return "global"
  return basename(worktree)
}

export function isDirectoryProject(projectId: string): boolean {
  return projectId === "global" || projectId.startsWith("dir:")
}

function looksLikePath(value: string): boolean {
  return value.startsWith("/") || /^[A-Za-z]:[\\/]/.test(value)
}

export function sessionProjectName(projectName: string, directory: string): string {
  if (!projectName || projectName === "/") return basename(directory) || "global"
  if (looksLikePath(projectName)) return basename(projectName)
  return projectName
}
