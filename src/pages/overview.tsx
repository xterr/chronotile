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
import { useQuery } from "@/hooks/use-query"
import { api, type RangeArgs } from "@/lib/api"
import { formatCost, formatCount, formatTokens } from "@/lib/format"
import { heatmapWindowStart } from "@/lib/heatmap"
import { useDashboard, type RangePreset } from "@/state/dashboard-context"
import { useSettings } from "@/state/settings-context"

const RANGE_TITLES: Record<RangePreset, string> = {
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  "90d": "Last 90 days",
  mtd: "Month to date",
  all: "All time",
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
  const { rangeArgs, activePath, range, anchor, selectedProject, cacheStatus } =
    useDashboard()
  const { settings } = useSettings()
  const enabled = activePath !== null
  const overview = useQuery(() => api.overview(rangeArgs), [rangeArgs], enabled)
  const daily = useQuery(() => api.dailySeries(rangeArgs), [rangeArgs], enabled)

  // Quantising to the day holds the heatmap window still across the anchor bump
  // that every range click triggers; the ingest epoch still refetches new data.
  const dayAnchor = useMemo(() => {
    const day = new Date(anchor)
    day.setHours(0, 0, 0, 0)
    return day.getTime()
  }, [anchor])
  const ingestEpoch = cacheStatus?.ingestEpoch ?? 0
  const heatmapArgs = useMemo<RangeArgs>(() => {
    const args: RangeArgs = {
      dbPaths: activePath ? [activePath] : [],
      from: heatmapWindowStart(dayAnchor).getTime(),
    }
    if (selectedProject) {
      args.project = selectedProject
    }
    return args
  }, [activePath, dayAnchor, selectedProject])
  const heatmap = useQuery(
    () => api.dailySeries(heatmapArgs),
    [heatmapArgs, ingestEpoch],
    enabled
  )

  const data = overview.data
  const totalTokens = data
    ? data.tokens.input +
      data.tokens.output +
      data.tokens.reasoning +
      data.tokens.cacheRead +
      data.tokens.cacheWrite
    : 0
  const cacheHit = data
    ? data.tokens.cacheRead /
      Math.max(1, data.tokens.input + data.tokens.cacheRead)
    : 0

  const dailyRows = useMemo(
    () =>
      (daily.data ?? []).map((d) => ({
        date: d.date,
        cost: d.cost,
        input: d.tokens.input,
        output: d.tokens.output,
        reasoning: d.tokens.reasoning,
        cacheRead: d.tokens.cacheRead,
        cacheWrite: d.tokens.cacheWrite,
      })),
    [daily.data]
  )

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 md:grid-cols-2">
        <StatCard
          emphasis="primary"
          label="Total cost"
          value={data ? formatCost(data.cost) : null}
          hint={
            data ? `across ${formatCount(data.sessions)} sessions` : undefined
          }
        />
        <StatCard
          emphasis="primary"
          label="Tokens"
          value={data ? formatTokens(totalTokens) : null}
          hint={
            data
              ? `${(cacheHit * 100).toFixed(1)}% served from cache`
              : undefined
          }
        />
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard
          label="Prompts"
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
            anchor={dayAnchor}
            focusFrom={rangeArgs.from}
            focusTo={rangeArgs.to}
          />
        </CardContent>
      </Card>
    </div>
  )
}
