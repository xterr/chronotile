import { useMemo } from "react"

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { formatCost, formatTokens } from "@/lib/format"
import type { DailyPoint } from "@/lib/api"

const WEEKS = 53

function intensityClass(value: number, max: number): string {
  if (value <= 0 || max <= 0) return "bg-muted"
  const ratio = value / max
  if (ratio < 0.25) return "bg-primary/25"
  if (ratio < 0.5) return "bg-primary/45"
  if (ratio < 0.75) return "bg-primary/70"
  return "bg-primary"
}

export type HeatmapMetric = "cost" | "tokens"

function metricValue(point: DailyPoint | undefined, metric: HeatmapMetric): number {
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

interface CalendarHeatmapProps {
  days: DailyPoint[]
  metric?: HeatmapMetric
}

export function CalendarHeatmap({ days, metric = "cost" }: CalendarHeatmapProps) {
  const { cells, max, monthLabels } = useMemo(() => {
    const byDate = new Map(days.map((d) => [d.date, d]))
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const end = today.getTime()
    const cursor = new Date(today)
    cursor.setDate(cursor.getDate() - ((WEEKS - 1) * 7 + today.getDay()))

    const cells: { date: string; point: DailyPoint | undefined; future: boolean }[] = []
    const monthLabels: { week: number; label: string }[] = []
    let lastMonth = -1
    for (let week = 0; week < WEEKS; week++) {
      for (let weekday = 0; weekday < 7; weekday++) {
        const iso = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}-${String(cursor.getDate()).padStart(2, "0")}`
        if (weekday === 0 && cursor.getMonth() !== lastMonth) {
          lastMonth = cursor.getMonth()
          monthLabels.push({
            week,
            label: cursor.toLocaleDateString("en-US", { month: "short" }),
          })
        }
        cells.push({
          date: iso,
          point: byDate.get(iso),
          future: cursor.getTime() > end,
        })
        cursor.setDate(cursor.getDate() + 1)
      }
    }
    const max = Math.max(0, ...days.map((d) => metricValue(d, metric)))
    return { cells, max, monthLabels }
  }, [days, metric])

  return (
    <div>
      <div
        className="mb-1 grid text-[10px] text-muted-foreground"
        style={{ gridTemplateColumns: `repeat(${WEEKS}, minmax(0.625rem, 1fr))` }}
      >
        {Array.from({ length: WEEKS }, (_, week) => (
          <span key={week}>
            {monthLabels.find((m) => m.week === week)?.label ?? ""}
          </span>
        ))}
      </div>
      <div
        className="grid grid-flow-col gap-0.5"
        style={{
          gridTemplateRows: "repeat(7, minmax(0, 1fr))",
          gridTemplateColumns: `repeat(${WEEKS}, minmax(0.625rem, 1fr))`,
        }}
      >
        {cells.map((cell) =>
          cell.future ? (
            <div key={cell.date} className="aspect-square rounded-xs" />
          ) : (
            <Tooltip key={cell.date}>
              <TooltipTrigger
                render={
                  <div
                    className={`aspect-square rounded-xs transition-transform duration-75 hover:z-10 hover:scale-150 hover:ring-1 hover:ring-foreground/40 ${intensityClass(metricValue(cell.point, metric), max)}`}
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
                        (cell.point?.tokens.cacheWrite ?? 0),
                    )}{" "}
                    tokens
                  </div>
                </div>
              </TooltipContent>
            </Tooltip>
          ),
        )}
      </div>
    </div>
  )
}
