import { useMemo } from "react"

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { formatCost, formatTokens, resolveCost } from "@/lib/format"
import {
  HEATMAP_WEEKS as WEEKS,
  heatmapWindowStart,
  isoDate,
  startOfDay,
} from "@/lib/heatmap"
import type { DailyPoint } from "@/lib/api"
import type { CostMode } from "@/state/settings-context"

const RAMP = ["bg-primary/25", "bg-primary/45", "bg-primary/70", "bg-primary"]

export type HeatmapMetric = "cost" | "tokens"

function metricValue(
  point: DailyPoint | undefined,
  metric: HeatmapMetric,
  costMode: CostMode
): number {
  if (!point) return 0
  if (metric === "cost") return resolveCost(point, costMode)
  return (
    point.tokens.input +
    point.tokens.output +
    point.tokens.reasoning +
    point.tokens.cacheRead +
    point.tokens.cacheWrite
  )
}

// Quartile cut points over the active days only. A linear scale against the
// maximum lets a single outlier day wash the rest of the year into one shade.
function buildScale(values: number[]): number[] {
  const sorted = values.filter((v) => v > 0).sort((a, b) => a - b)
  if (sorted.length === 0) return []
  const at = (quantile: number) =>
    sorted[Math.min(sorted.length - 1, Math.floor(quantile * sorted.length))]
  return [at(0.25), at(0.5), at(0.75)]
}

function intensityClass(value: number, scale: number[]): string {
  if (value <= 0 || scale.length === 0) return "bg-muted/40"
  for (let i = 0; i < scale.length; i++) {
    if (value <= scale[i]) return RAMP[i]
  }
  return RAMP[RAMP.length - 1]
}

interface Cell {
  date: string
  point: DailyPoint | undefined
  future: boolean
  dimmed: boolean
}

interface CalendarHeatmapProps {
  days: DailyPoint[]
  metric?: HeatmapMetric
  costMode?: CostMode
  /** Last day of the 12-month window. */
  anchor: number
  /** Start of the highlighted range; earlier days dim. Omit to highlight all. */
  focusFrom?: number
  /** End of the highlighted range; later days dim. Omit to highlight all. */
  focusTo?: number
}

export function CalendarHeatmap({
  days,
  metric = "cost",
  costMode = "estimated",
  anchor,
  focusFrom,
  focusTo,
}: CalendarHeatmapProps) {
  const view = useMemo(() => {
    const byDate = new Map(days.map((d) => [d.date, d]))
    const end = isoDate(startOfDay(anchor))
    const focusStart =
      focusFrom === undefined ? null : isoDate(startOfDay(focusFrom))
    const focusEnd = focusTo === undefined ? null : isoDate(startOfDay(focusTo))

    const cells: Cell[] = []
    const labels: { index: number; label: string }[] = []
    const values: number[] = []
    const cursor = heatmapWindowStart(anchor)
    let lastMonth = -1

    for (let week = 0; week < WEEKS; week++) {
      for (let weekday = 0; weekday < 7; weekday++) {
        const date = isoDate(cursor)
        if (weekday === 0 && cursor.getMonth() !== lastMonth) {
          lastMonth = cursor.getMonth()
          labels.push({
            index: week,
            label: cursor.toLocaleDateString("en-US", { month: "short" }),
          })
        }
        const future = date > end
        const point = byDate.get(date)
        if (!future) values.push(metricValue(point, metric, costMode))
        cells.push({
          date,
          point,
          future,
          dimmed:
            (focusStart !== null && date < focusStart) ||
            (focusEnd !== null && date > focusEnd),
        })
        cursor.setDate(cursor.getDate() + 1)
      }
    }

    return { cells, labels, scale: buildScale(values) }
  }, [days, metric, costMode, anchor, focusFrom, focusTo])

  const template = `repeat(${WEEKS}, minmax(0.625rem, 1fr))`

  return (
    <div className="flex flex-col gap-2">
      <div className="w-full">
        <div
          className="mb-1 grid text-[10px] tracking-micro whitespace-nowrap text-muted-foreground"
          style={{ gridTemplateColumns: template }}
        >
          {Array.from({ length: WEEKS }, (_, index) => (
            <span key={index}>
              {view.labels.find((l) => l.index === index)?.label ?? ""}
            </span>
          ))}
        </div>
        <div
          className="grid grid-flow-col gap-0.5"
          style={{
            gridTemplateRows: "repeat(7, minmax(0, 1fr))",
            gridTemplateColumns: template,
          }}
        >
          {view.cells.map((cell) =>
            cell.future ? (
              <div key={cell.date} className="aspect-square rounded-xs" />
            ) : (
              <Tooltip key={cell.date}>
                <TooltipTrigger
                  render={
                    <div
                      className={`aspect-square rounded-xs transition-[transform,opacity] duration-75 hover:z-10 hover:scale-150 hover:opacity-100 hover:ring-1 hover:ring-foreground/40 ${intensityClass(metricValue(cell.point, metric, costMode), view.scale)} ${cell.dimmed ? "opacity-30" : ""}`}
                    />
                  }
                />
                <TooltipContent>
                  <div className="text-xs">
                    <div className="font-medium">{cell.date}</div>
                    <div>
                      {formatCost(cell.point ? resolveCost(cell.point, costMode) : 0)} ·{" "}
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
      <div className="flex items-center justify-end gap-1 text-[10px] tracking-micro text-muted-foreground">
        <span>Less</span>
        <div className="size-2.5 rounded-xs bg-muted/40" />
        {RAMP.map((tone) => (
          <div key={tone} className={`size-2.5 rounded-xs ${tone}`} />
        ))}
        <span>More</span>
      </div>
    </div>
  )
}
