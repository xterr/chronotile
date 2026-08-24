export const HEATMAP_WEEKS = 53

export function startOfDay(ms: number): Date {
  const date = new Date(ms)
  date.setHours(0, 0, 0, 0)
  return date
}

export function isoDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
}

// Rewinding to the anchor's Sunday makes the window exactly HEATMAP_WEEKS
// columns of seven, with the anchor day landing in the final column.
export function heatmapWindowStart(anchor: number): Date {
  const start = startOfDay(anchor)
  start.setDate(start.getDate() - ((HEATMAP_WEEKS - 1) * 7 + start.getDay()))
  return start
}
