import { useMemo } from "react"

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { formatCost, formatTokens } from "@/lib/format"
import type { DailyPoint } from "@/lib/api"

const STRIP_MAX_DAYS = 31
const LABEL_EVERY = 7

function intensityClass(value: number, max: number): string {
  if (value <= 0 || max <= 0) return "bg-muted"
  const ratio = value / max
  if (ratio < 0.25) return "bg-primary/25"
  if (ratio < 0.5) return "bg-primary/45"
  if (ratio < 0.75) return "bg-primary/70"
  return "bg-primary"
}

export type HeatmapMetric = "cost" | "tokens"

function metricValue(
  point: DailyPoint | undefined,
  metric: HeatmapMetric
): number {
  if (!point) return 0
  if (metric === "cost") return point.cost
  return (
    point.tokens.input +
    point.tokens.output +
    point.tokens.reasoning +
    point.tokens.cacheRead +
    point.tokens.cacheWrite
  )
}

function isoDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
}

function startOfDay(ms: number): Date {
  const date = new Date(ms)
  date.setHours(0, 0, 0, 0)
  return date
}

// Stepping a Date avoids the off-by-one that millisecond arithmetic produces
// across daylight-saving boundaries.
function daysBetween(start: Date, end: Date): number {
  let count = 0
  const probe = new Date(start)
  while (probe <= end) {
    count++
    probe.setDate(probe.getDate() + 1)
  }
  return count
}

interface Cell {
  date: string
  point: DailyPoint | undefined
  outside: boolean
}

interface CalendarHeatmapProps {
  days: DailyPoint[]
  metric?: HeatmapMetric
  from?: number
  to: number
}

export function CalendarHeatmap({
  days,
  metric = "cost",
  from,
  to,
}: CalendarHeatmapProps) {
  const view = useMemo(() => {
    const byDate = new Map(days.map((d) => [d.date, d]))
    const end = startOfDay(to)

    const earliest = days.length
      ? days.reduce((a, b) => (a.date < b.date ? a : b)).date
      : null
    let start =
      from === undefined
        ? earliest
          ? startOfDay(new Date(`${earliest}T00:00:00`).getTime())
          : end
        : startOfDay(from)
    if (start > end) start = end

    const max = Math.max(0, ...days.map((d) => metricValue(d, metric)))
    const span = daysBetween(start, end)

    if (span <= STRIP_MAX_DAYS) {
      const cells: Cell[] = []
      const labels: { index: number; label: string }[] = []
      const cursor = new Date(start)
      for (let i = 0; i < span; i++) {
        const iso = isoDate(cursor)
        cells.push({ date: iso, point: byDate.get(iso), outside: false })
        if (i % LABEL_EVERY === 0) {
          labels.push({
            index: i,
            label: cursor.toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
            }),
          })
        }
        cursor.setDate(cursor.getDate() + 1)
      }
      return { mode: "strip" as const, cells, columns: span, labels, max }
    }

    const gridStart = new Date(start)
    gridStart.setDate(gridStart.getDate() - gridStart.getDay())
    const gridEnd = new Date(end)
    gridEnd.setDate(gridEnd.getDate() + (6 - gridEnd.getDay()))

    const weeks = Math.ceil(daysBetween(gridStart, gridEnd) / 7)
    const withYear = span > 365
    const cells: Cell[] = []
    const labels: { index: number; label: string }[] = []
    const cursor = new Date(gridStart)
    let lastMonth = -1
    for (let week = 0; week < weeks; week++) {
      for (let weekday = 0; weekday < 7; weekday++) {
        const iso = isoDate(cursor)
        const time = cursor.getTime()
        if (weekday === 0 && cursor.getMonth() !== lastMonth) {
          lastMonth = cursor.getMonth()
          labels.push({
            index: week,
            label: cursor.toLocaleDateString("en-US", {
              month: "short",
              ...(withYear ? { year: "2-digit" } : {}),
            }),
          })
        }
        cells.push({
          date: iso,
          point: byDate.get(iso),
          outside: time > end.getTime() || time < start.getTime(),
        })
        cursor.setDate(cursor.getDate() + 1)
      }
    }
    return { mode: "calendar" as const, cells, columns: weeks, labels, max }
  }, [days, metric, from, to])

  const template = `repeat(${view.columns}, minmax(0.625rem, 1.25rem))`

  return (
    <div className="overflow-x-auto">
      <div className="w-fit">
        <div
          className="mb-1 grid text-[10px] whitespace-nowrap text-muted-foreground"
          style={{ gridTemplateColumns: template }}
        >
          {Array.from({ length: view.columns }, (_, index) => (
            <span key={index}>
              {view.labels.find((l) => l.index === index)?.label ?? ""}
            </span>
          ))}
        </div>
        <div
          className="grid grid-flow-col gap-0.5"
          style={{
            gridTemplateRows: `repeat(${view.mode === "strip" ? 1 : 7}, minmax(0, 1fr))`,
            gridTemplateColumns: template,
          }}
        >
          {view.cells.map((cell) =>
            cell.outside ? (
              <div key={cell.date} className="aspect-square rounded-xs" />
            ) : (
              <Tooltip key={cell.date}>
                <TooltipTrigger
                  render={
                    <div
                      className={`aspect-square rounded-xs transition-transform duration-75 hover:z-10 hover:scale-150 hover:ring-1 hover:ring-foreground/40 ${intensityClass(metricValue(cell.point, metric), view.max)}`}
                    />
                  }
                />
                <TooltipContent>
                  <div className="text-xs">
                    <div className="font-medium">{cell.date}</div>
                    <div>
                      {formatCost(cell.point?.cost ?? 0)} ·{" "}
                      {formatTokens(
                        (cell.point?.tokens.input ?? 0) +
                          (cell.point?.tokens.output ?? 0) +
                          (cell.point?.tokens.reasoning ?? 0) +
                          (cell.point?.tokens.cacheRead ?? 0) +
                          (cell.point?.tokens.cacheWrite ?? 0)
                      )}{" "}
                      tokens
                    </div>
                  </div>
                </TooltipContent>
              </Tooltip>
            )
          )}
        </div>
      </div>
    </div>
  )
}
