import { useMemo } from "react"
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  XAxis,
  YAxis,
} from "recharts"

import { CalendarHeatmap } from "@/components/calendar-heatmap"
import { StatCard } from "@/components/stat-card"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  chartSeriesAnimation,
  type ChartConfig,
} from "@/components/ui/chart"
import { useQuery } from "@tanstack/react-query"
import { api, type RangeArgs, type TokenTotals } from "@/lib/api"
import {
  formatCost,
  formatCostMode,
  formatCount,
  formatTokens,
  resolveCost,
} from "@/lib/format"
import { heatmapWindowStart } from "@/lib/heatmap"
import { useDashboard, type RangePreset } from "@/state/dashboard-context"
import { useSettings } from "@/state/settings-context"

const RANGE_TITLES: Record<RangePreset, string> = {
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  "90d": "Last 90 days",
  mtd: "Month to date",
  all: "All time",
  custom: "Custom range",
}

function sumTokens(tokens: TokenTotals): number {
  return (
    tokens.input +
    tokens.output +
    tokens.reasoning +
    tokens.cacheRead +
    tokens.cacheWrite
  )
}

const costConfig = {
  cost: { label: "Cost", color: "var(--chart-1)" },
} satisfies ChartConfig

const tokenConfig = {
  input: { label: "Input", color: "var(--chart-1)" },
  output: { label: "Output", color: "var(--chart-2)" },
  reasoning: { label: "Reasoning", color: "var(--chart-3)" },
  cacheRead: { label: "Cache read", color: "var(--chart-4)" },
  cacheWrite: { label: "Cache write", color: "var(--chart-5)" },
} satisfies ChartConfig

export function OverviewPage() {
  const { rangeArgs, activePath, range, anchor, selectedProject } =
    useDashboard()
  const { settings } = useSettings()
  const costMode = settings.costMode
  const enabled = activePath !== null
  const overview = useQuery({
    queryKey: ["overview", rangeArgs],
    queryFn: () => api.overview(rangeArgs),
    enabled,
  })
  const daily = useQuery({
    queryKey: ["dailySeries", rangeArgs],
    queryFn: () => api.dailySeries(rangeArgs),
    enabled,
  })

  /* The previous period is the same span immediately before this one. "All time"
     has nothing to compare against, so the comparison is simply absent there
     rather than invented. */
  const previousArgs = useMemo<RangeArgs | null>(() => {
    if (rangeArgs.from === undefined) return null
    const to = rangeArgs.to ?? anchor
    const span = to - rangeArgs.from
    if (span <= 0) return null
    return { ...rangeArgs, from: rangeArgs.from - span, to: rangeArgs.from - 1 }
  }, [rangeArgs, anchor])

  const previous = useQuery({
    queryKey: ["overview", previousArgs],
    queryFn: () => api.overview(previousArgs as RangeArgs),
    enabled: enabled && previousArgs !== null,
  })

  const changeVs = (current: number | undefined, before: number | undefined) => {
    if (current === undefined || before === undefined || before <= 0) return null
    return (current - before) / before
  }

  const heatmapArgs = useMemo<RangeArgs>(() => {
    const args: RangeArgs = {
      dbPaths: activePath ? [activePath] : [],
      from: heatmapWindowStart(anchor).getTime(),
    }
    if (selectedProject) {
      args.project = selectedProject
    }
    return args
  }, [activePath, anchor, selectedProject])
  const heatmap = useQuery({
    queryKey: ["dailySeries", heatmapArgs],
    queryFn: () => api.dailySeries(heatmapArgs),
    enabled,
  })

  const data = overview.data
  const totalTokens = data ? sumTokens(data.tokens) : 0

  /* Cost = usage x rate, so a change in spend splits into the part explained by
     doing more work and the part explained by the blended price per token
     moving — which happens when the model mix or the cache-hit ratio shifts.
     The two components add back up to the total change by construction. */
  const spendShift = useMemo(() => {
    if (!data || !previous.data) return null
    const nowTokens = sumTokens(data.tokens)
    const beforeTokens = sumTokens(previous.data.tokens)
    if (nowTokens <= 0 || beforeTokens <= 0) return null

    const nowCost = resolveCost(data, costMode)
    const beforeCost = resolveCost(previous.data, costMode)
    const nowRate = nowCost / nowTokens
    const beforeRate = beforeCost / beforeTokens
    const total = nowCost - beforeCost
    if (Math.abs(total) < 0.01) return null

    return {
      total,
      usage: (nowTokens - beforeTokens) * beforeRate,
      rate: (nowRate - beforeRate) * nowTokens,
    }
  }, [data, previous.data, costMode])
  const cacheHit = data
    ? data.tokens.cacheRead /
      Math.max(1, data.tokens.input + data.tokens.cacheRead)
    : 0

  const dailyRows = useMemo(
    () =>
      (daily.data ?? []).map((d) => ({
        date: d.date,
        cost: resolveCost(d, costMode),
        input: d.tokens.input,
        output: d.tokens.output,
        reasoning: d.tokens.reasoning,
        cacheRead: d.tokens.cacheRead,
        cacheWrite: d.tokens.cacheWrite,
      })),
    [daily.data, costMode]
  )

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-10">
        <StatCard
          emphasis="primary"
          className="col-span-2"
          label="Total cost"
          delta={changeVs(
            data ? resolveCost(data, costMode) : undefined,
            previous.data ? resolveCost(previous.data, costMode) : undefined
          )}
          value={data ? formatCostMode(data, costMode) : null}
          hint={
            data
              ? costMode === "both"
                ? "estimated / reported"
                : `across ${formatCount(data.sessions)} sessions`
              : undefined
          }
        />
        <StatCard
          emphasis="primary"
          className="col-span-2"
          label="Tokens"
          delta={changeVs(
            totalTokens || undefined,
            previous.data
              ? previous.data.tokens.input +
                previous.data.tokens.output +
                previous.data.tokens.reasoning +
                previous.data.tokens.cacheRead +
                previous.data.tokens.cacheWrite
              : undefined
          )}
          value={data ? formatTokens(totalTokens) : null}
          hint={
            data
              ? `${(cacheHit * 100).toFixed(1)}% served from cache`
              : undefined
          }
        />
        <StatCard
          className="col-span-2"
          label="Saved by caching"
          value={data ? formatCost(data.cacheSavings) : null}
          hint="versus sending every cached token fresh"
        />
        <StatCard
          label="Prompts"
          delta={changeVs(data?.prompts, previous.data?.prompts)}
          value={data ? formatCount(data.prompts) : null}
        />
        <StatCard
          label="Tool calls"
          value={data ? formatCount(data.toolCalls) : null}
        />
        <StatCard
          label="Models"
          value={data ? formatCount(data.modelsUsed) : null}
        />
        <StatCard
          label="Active days"
          value={data ? formatCount(data.activeDays) : null}
        />
      </div>

      {spendShift && (
        <p className="text-sm text-muted-foreground">
          Spend is {spendShift.total > 0 ? "up" : "down"}{" "}
          <span className="font-medium text-foreground">
            {formatCost(Math.abs(spendShift.total))}
          </span>{" "}
          on the previous period —{" "}
          <span className="font-medium text-foreground">
            {formatCost(Math.abs(spendShift.usage))}
          </span>{" "}
          from {spendShift.usage >= 0 ? "more" : "less"} usage and{" "}
          <span className="font-medium text-foreground">
            {formatCost(Math.abs(spendShift.rate))}
          </span>{" "}
          from a {spendShift.rate >= 0 ? "higher" : "lower"} blended rate per
          token.
        </p>
      )}

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Daily cost</CardTitle>
            <CardDescription>USD spent per day</CardDescription>
          </CardHeader>
          <CardContent>
            <ChartContainer config={costConfig} className="h-64 w-full">
              <AreaChart data={dailyRows} accessibilityLayer>
                <CartesianGrid vertical={false} />
                <XAxis
                  dataKey="date"
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                  tickFormatter={(value: string) => value.slice(5)}
                />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  width={50}
                  tickFormatter={(value: number) => formatCost(value)}
                />
                <ChartTooltip
                  content={
                    <ChartTooltipContent
                      formatter={(value) => formatCost(Number(value))}
                    />
                  }
                />
                <Area
                  dataKey="cost"
                  type="monotone"
                  fill="var(--color-cost)"
                  fillOpacity={0.25}
                  stroke="var(--color-cost)"
                  {...chartSeriesAnimation}
                />
              </AreaChart>
            </ChartContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Daily tokens</CardTitle>
            <CardDescription>Token breakdown per day</CardDescription>
          </CardHeader>
          <CardContent>
            <ChartContainer config={tokenConfig} className="h-64 w-full">
              <BarChart data={dailyRows} accessibilityLayer>
                <CartesianGrid vertical={false} />
                <XAxis
                  dataKey="date"
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                  tickFormatter={(value: string) => value.slice(5)}
                />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  width={50}
                  tickFormatter={(value: number) => formatTokens(value)}
                />
                <ChartTooltip
                  content={
                    <ChartTooltipContent
                      formatter={(value, name, item) => (
                        <div className="flex w-full items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5">
                            <div
                              className="size-2 rounded-xs"
                              style={{ background: item.color }}
                            />
                            {
                              tokenConfig[name as keyof typeof tokenConfig]
                                .label
                            }
                          </div>
                          <span className="font-mono tabular-nums">
                            {formatTokens(Number(value))}
                          </span>
                        </div>
                      )}
                    />
                  }
                />
                {Object.keys(tokenConfig).map((key) => (
                  <Bar
                    key={key}
                    dataKey={key}
                    stackId="tokens"
                    fill={`var(--color-${key})`}
                    {...chartSeriesAnimation}
                  />
                ))}
              </BarChart>
            </ChartContainer>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Last 12 months</CardTitle>
          <CardDescription>
            Daily {settings.heatmapMetric === "cost" ? "spend" : "token"}{" "}
            intensity
            {range === "all" ? "" : ` · ${RANGE_TITLES[range]} highlighted`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <CalendarHeatmap
            days={heatmap.data ?? []}
            metric={settings.heatmapMetric}
            anchor={anchor}
            focusFrom={rangeArgs.from}
            focusTo={rangeArgs.to}
          />
        </CardContent>
      </Card>
    </div>
  )
}
