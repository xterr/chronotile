import type { CostMode } from "@/state/settings-context"

export function formatCost(value: number): string {
  if (value >= 1000) return `$${(value / 1000).toFixed(2)}k`
  if (value >= 1) return `$${value.toFixed(2)}`
  // Sub-dollar costs keep up to four decimals so a fraction of a cent stays
  // visible, without padding ($0.36, not $0.3600) and without dropping below
  // the two decimals currency is normally written with ($0.50, not $0.5).
  const significant = value.toFixed(4).replace(/0+$/, "").split(".")[1] ?? ""
  return `$${value.toFixed(Math.max(2, significant.length))}`
}

/**
 * Resolves the cost a page should display. Reported cost is $0 on subscription
 * traffic, so `estimated` falls back to reported only when the model is
 * unpriced — otherwise an unpriced model would read as free.
 */
export function resolveCost(
  row: { cost: number; costEstimated: number },
  mode: CostMode
): number {
  if (mode === "reported") return row.cost
  return row.costEstimated > 0 ? row.costEstimated : row.cost
}

export function formatCostMode(
  row: { cost: number; costEstimated: number },
  mode: CostMode
): string {
  if (mode !== "both") return formatCost(resolveCost(row, mode))
  return `${formatCost(row.costEstimated)} / ${formatCost(row.cost)}`
}

export function formatTokens(value: number): string {
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)}B`
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`
  return `${value}`
}

export function formatPercent(fraction: number): string {
  return `${(fraction * 100).toFixed(fraction < 0.1 ? 1 : 0)}%`
}

export function formatCount(value: number): string {
  return new Intl.NumberFormat("en-US").format(value)
}

export function formatDuration(ms: number): string {
  if (ms >= 60_000) return `${(ms / 60_000).toFixed(1)}m`
  if (ms >= 1_000) return `${(ms / 1_000).toFixed(1)}s`
  return `${Math.round(ms)}ms`
}

export function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
}

export function formatRelativeTime(ts: number): string {
  const diff = Math.max(0, Date.now() - ts)
  if (diff < 60_000) return "just now"
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  return `${Math.floor(diff / 86_400_000)}d ago`
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(1)} GB`
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`
  return `${(bytes / 1024).toFixed(0)} KB`
}

export function modelLabel(key: string): string {
  const idx = key.indexOf("/")
  return idx >= 0 ? key.slice(idx + 1) : key
}

export const CHART_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
  "var(--chart-6)",
  "var(--chart-7)",
  "var(--chart-8)",
]

export function chartColor(index: number): string {
  return CHART_COLORS[index % CHART_COLORS.length]
}
