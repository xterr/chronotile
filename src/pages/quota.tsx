import { useEffect, useState } from "react"
import { useQuery } from "@tanstack/react-query"

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { StatCard } from "@/components/stat-card"
import { api } from "@/lib/api"
import { formatCost, formatCount, formatTokens } from "@/lib/format"
import { useDashboard } from "@/state/dashboard-context"
import { useSettings } from "@/state/settings-context"

function clockTime(ts: number): string {
  return new Date(ts).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  })
}

function countdown(ms: number): string {
  const minutes = Math.max(0, Math.round(ms / 60_000))
  const hours = Math.floor(minutes / 60)
  return hours > 0 ? `${hours}h ${minutes % 60}m` : `${minutes}m`
}

/**
 * The window countdown is the one number that changes without any new data, so
 * it ticks on its own clock rather than only when a query resolves.
 */
function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}

export function QuotaPage() {
  const { activePath } = useDashboard()
  const now = useNow(30_000)
  const { costMode, quotaWindowHours } = useSettings().settings
  const enabled = activePath !== null

  const quota = useQuery({
    queryKey: ["quota", activePath, quotaWindowHours],
    queryFn: () => api.quota(activePath ? [activePath] : [], quotaWindowHours),
    enabled,
    // The active window moves in real time, so this is the one view that is
    // wrong the moment it stops refreshing.
    refetchInterval: 60_000,
  })

  const report = quota.data
  const active = report?.active ?? null
  const reference = report?.referenceTokens ?? 0
  const used = active?.tokens ?? 0
  const fraction = reference > 0 ? used / reference : 0
  const projectedFraction = reference > 0 ? (report?.projectedTokens ?? 0) / reference : 0
  const warn = report ? projectedFraction >= report.warnFraction : false

  const cost = (window: { cost: number; costEstimated: number }) =>
    costMode === "reported" ? window.cost : window.costEstimated || window.cost

  if (report && report.windows.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>No recent activity</CardTitle>
          <CardDescription>
            Rolling windows are built from the last two weeks of messages. Use
            opencode and this fills in.
          </CardDescription>
        </CardHeader>
      </Card>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>
            {active
              ? `Current ${report?.windowHours}-hour window`
              : `No window open`}
          </CardTitle>
          <CardDescription>
            {active
              ? `Started ${clockTime(active.start)} · resets in ${countdown(active.end - now)}`
              : `The next message opens a new ${report?.windowHours}-hour window.`}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="h-3 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-500"
              style={{ width: `${Math.min(100, fraction * 100).toFixed(1)}%` }}
            />
          </div>
          <div className="flex flex-wrap justify-between gap-2 text-sm">
            <span className="tabular-nums">
              {formatTokens(used)} used
              {active ? ` · ${formatCost(cost(active))}` : ""}
            </span>
            <span className="text-muted-foreground tabular-nums">
              busiest so far {formatTokens(reference)}
            </span>
          </div>
          {warn ? (
            <span className="text-sm text-muted-foreground">
              At this rate the window ends near your busiest on record.
            </span>
          ) : null}
          <span className="text-xs text-muted-foreground">
            opencode does not record plan limits, so the bar is measured against
            your own busiest window — not a quota. Pay-as-you-go API keys have no
            rolling window at all; this is then simply how hard you have been
            going.
          </span>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Burn rate"
          value={report ? `${formatTokens(Math.round(report.burnTokensPerMin))}/min` : null}
          hint={report ? `${formatCost(report.burnCostPerMin * 60)} per hour` : undefined}
        />
        <StatCard
          label="Projected this window"
          value={report ? formatTokens(report.projectedTokens) : null}
          hint={report ? formatCost(report.projectedCost) : undefined}
        />
        <StatCard
          label="Last 7 days"
          value={report ? formatTokens(report.weekTokens) : null}
          hint={
            report
              ? formatCost(
                  costMode === "reported"
                    ? report.weekCost
                    : report.weekCostEstimated || report.weekCost
                )
              : undefined
          }
        />
        <StatCard
          label="Windows on record"
          value={report ? formatCount(report.windows.length) : null}
          hint="last 14 days"
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent windows</CardTitle>
          <CardDescription>
            Each bar is one {report?.windowHours}-hour window, newest first
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-end gap-1 h-32">
            {(report?.windows ?? []).map((window) => {
              const height =
                reference > 0
                  ? Math.max(2, Math.min(100, (window.tokens / reference) * 100))
                  : 2
              return (
                <div
                  key={window.start}
                  title={`${clockTime(window.start)} · ${formatTokens(window.tokens)} · ${formatCost(cost(window))}`}
                  className={`min-w-1.5 flex-1 rounded-t-xs transition-opacity hover:opacity-70 ${
                    window.active ? "bg-primary" : "bg-primary/40"
                  }`}
                  style={{ height: `${height}%` }}
                />
              )
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
