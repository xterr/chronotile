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
}

export function StatCard({
  label,
  value,
  hint,
  emphasis = "default",
  className,
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
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </CardHeader>
    </Card>
  )
}
