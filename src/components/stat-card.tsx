import { ArrowDownRight, ArrowUpRight } from "lucide-react"

import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"

interface StatCardProps {
  label: string
  value: string | null
  hint?: string
  emphasis?: "default" | "primary"
  className?: string
  /** Fractional change against the previous period, e.g. 0.12 for +12%. */
  delta?: number | null
}

function DeltaChip({ delta }: { delta: number }) {
  const up = delta > 0
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-xs font-medium tabular-nums",
        up ? "bg-destructive/10 text-destructive" : "bg-primary/10 text-primary"
      )}
    >
      {up ? <ArrowUpRight className="size-3" /> : <ArrowDownRight className="size-3" />}
      {Math.abs(delta * 100).toFixed(0)}%
    </span>
  )
}

export function StatCard({
  label,
  value,
  hint,
  emphasis = "default",
  className,
  delta,
}: StatCardProps) {
  const isPrimary = emphasis === "primary"

  return (
    <Card className={cn("gap-1 py-4", isPrimary && "py-5", className)}>
      <CardHeader className={cn("px-4", isPrimary && "px-5")}>
        <CardDescription>{label}</CardDescription>
        {value === null ? (
          <Skeleton className={isPrimary ? "h-10 w-40" : "h-8 w-24"} />
        ) : (
          <CardTitle
            className={cn(
              "tabular-nums",
              isPrimary
                ? "text-4xl leading-10 tracking-display"
                : "text-2xl tracking-figure"
            )}
          >
            {value}
          </CardTitle>
        )}
        {(hint || (delta !== null && delta !== undefined)) && (
          <div className="flex items-center gap-1.5">
            {delta !== null && delta !== undefined && Number.isFinite(delta) ? (
              <DeltaChip delta={delta} />
            ) : null}
            {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
          </div>
        )}
      </CardHeader>
    </Card>
  )
}
