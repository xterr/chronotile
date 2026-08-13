import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { useDashboard, type RangePreset } from "@/state/dashboard-context"

const PRESETS: { value: RangePreset; label: string }[] = [
  { value: "7d", label: "7d" },
  { value: "30d", label: "30d" },
  { value: "90d", label: "90d" },
  { value: "mtd", label: "MTD" },
  { value: "all", label: "All" },
]

export function RangePicker() {
  const { range, setRange } = useDashboard()
  return (
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
  )
}
