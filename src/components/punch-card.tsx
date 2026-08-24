import { useMemo } from "react"

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { formatCount } from "@/lib/format"
import type { HourlyCell } from "@/lib/api"

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

function intensityClass(value: number, max: number): string {
  if (value <= 0 || max <= 0) return "bg-muted"
  const ratio = value / max
  if (ratio < 0.25) return "bg-primary/25"
  if (ratio < 0.5) return "bg-primary/45"
  if (ratio < 0.75) return "bg-primary/70"
  return "bg-primary"
}

export function PunchCard({ cells }: { cells: HourlyCell[] }) {
  const { grid, max } = useMemo(() => {
    const grid = new Map(cells.map((c) => [`${c.weekday}-${c.hour}`, c.count]))
    const max = Math.max(0, ...cells.map((c) => c.count))
    return { grid, max }
  }, [cells])

  return (
    <div className="flex flex-col gap-0.5">
      {WEEKDAYS.map((day, weekday) => (
        <div key={day} className="flex items-center gap-0.5">
          <span className="w-8 shrink-0 text-[10px] tracking-micro text-muted-foreground">
            {day}
          </span>
          {Array.from({ length: 24 }, (_, hour) => {
            const count = grid.get(`${weekday}-${hour}`) ?? 0
            return (
              <Tooltip key={hour}>
                <TooltipTrigger
                  render={
                    <div
                      className={`h-4 flex-1 rounded-xs transition-transform duration-75 hover:z-10 hover:scale-y-150 hover:scale-x-125 hover:ring-1 hover:ring-foreground/40 ${intensityClass(count, max)}`}
                    />
                  }
                />
                <TooltipContent>
                  <div className="text-xs">
                    <span className="font-medium">
                      {day} {String(hour).padStart(2, "0")}:00
                    </span>{" "}
                    — {formatCount(count)} messages
                  </div>
                </TooltipContent>
              </Tooltip>
            )
          })}
        </div>
      ))}
      <div className="mt-1 flex items-center gap-0.5">
        <span className="w-8 shrink-0" />
        {Array.from({ length: 24 }, (_, hour) => (
          <span
            key={hour}
            className="flex-1 text-center text-[9px] text-muted-foreground"
          >
            {hour % 6 === 0 ? hour : ""}
          </span>
        ))}
      </div>
    </div>
  )
}
