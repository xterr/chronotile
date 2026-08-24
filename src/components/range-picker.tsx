import { CalendarRange } from "lucide-react"
import type { DateRange } from "react-day-picker"

import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { useDashboard, type RangePreset } from "@/state/dashboard-context"

const PRESETS: { value: RangePreset; label: string }[] = [
  { value: "7d", label: "7d" },
  { value: "30d", label: "30d" },
  { value: "90d", label: "90d" },
  { value: "mtd", label: "MTD" },
  { value: "all", label: "All" },
]

/**
 * Local calendar date, not UTC: `toISOString` would shift the day for anyone
 * east or west of Greenwich, selecting a range off by one from what was clicked.
 */
function toISODate(date: Date): string {
  const month = `${date.getMonth() + 1}`.padStart(2, "0")
  const day = `${date.getDate()}`.padStart(2, "0")
  return `${date.getFullYear()}-${month}-${day}`
}

function fromISODate(value: string | null): Date | undefined {
  if (!value) return undefined
  const [year, month, day] = value.split("-").map(Number)
  if (!year || !month || !day) return undefined
  return new Date(year, month - 1, day)
}

function shortDate(value: string | null): string {
  const date = fromISODate(value)
  return date
    ? date.toLocaleDateString("en-US", { month: "short", day: "numeric" })
    : "…"
}

export function RangePicker() {
  const { range, setRange, customFrom, customTo, setCustomRange } =
    useDashboard()

  const selected: DateRange | undefined = customFrom
    ? { from: fromISODate(customFrom), to: fromISODate(customTo) }
    : undefined

  const onSelect = (next: DateRange | undefined) => {
    if (!next?.from) {
      setCustomRange(null, null)
      return
    }
    setCustomRange(toISODate(next.from), next.to ? toISODate(next.to) : null)
    setRange("custom")
  }

  return (
    <div className="flex items-center gap-1">
      <ToggleGroup
        variant="outline"
        size="sm"
        value={[range]}
        onValueChange={(value: string[]) => {
          const next = value[0]
          if (next) setRange(next as RangePreset)
        }}
      >
        {PRESETS.map((preset) => (
          <ToggleGroupItem key={preset.value} value={preset.value}>
            {preset.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>

      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant={range === "custom" ? "secondary" : "outline"}
              size="sm"
              aria-label="Custom date range"
            >
              <CalendarRange />
              {range === "custom" && customFrom
                ? `${shortDate(customFrom)} – ${shortDate(customTo)}`
                : "Custom"}
            </Button>
          }
        />
        <DropdownMenuContent align="end" className="w-auto p-0">
          <Calendar
            mode="range"
            numberOfMonths={2}
            defaultMonth={fromISODate(customFrom)}
            selected={selected}
            onSelect={onSelect}
            disabled={{ after: new Date() }}
            autoFocus
          />
          <div className="flex justify-end border-t p-2">
            <Button
              variant="ghost"
              size="sm"
              disabled={!customFrom && !customTo}
              onClick={() => {
                setCustomRange(null, null)
                setRange("30d")
              }}
            >
              Clear
            </Button>
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
