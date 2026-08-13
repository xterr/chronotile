import { useMemo } from "react"
import {
  Area,
  AreaChart,
  CartesianGrid,
  Label,
  Pie,
  PieChart,
  XAxis,
  YAxis,
} from "recharts"

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
  type ChartConfig,
} from "@/components/ui/chart"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { useQuery } from "@/hooks/use-query"
import { api, type GroupStat } from "@/lib/api"
import { chartColor, formatCost, formatCount, formatTokens, modelLabel } from "@/lib/format"
import { useDashboard } from "@/state/dashboard-context"

const TOP_SERIES = 5

interface GroupBreakdownProps {
  groupBy: "model" | "agent"
  title: string
}

function totalTokens(stat: GroupStat): number {
  return (
    stat.tokens.input +
    stat.tokens.output +
    stat.tokens.reasoning +
    stat.tokens.cacheRead +
    stat.tokens.cacheWrite
  )
}

export function GroupBreakdown({ groupBy, title }: GroupBreakdownProps) {
  const { rangeArgs, activePath } = useDashboard()
  const enabled = activePath !== null
  const stats = useQuery(
    () => (groupBy === "model" ? api.modelStats(rangeArgs) : api.agentStats(rangeArgs)),
    [rangeArgs, groupBy],
    enabled,
  )
  const dailyByKey = useQuery(
    () => api.modelDaily({ ...rangeArgs, groupBy }),
    [rangeArgs, groupBy],
    enabled,
  )

  const rows = useMemo(() => stats.data ?? [], [stats.data])
  const label = useMemo(
    () => (groupBy === "model" ? modelLabel : (key: string) => key),
    [groupBy],
  )
  const totalCost = useMemo(
    () => rows.reduce((sum, row) => sum + row.cost, 0),
    [rows],
  )

  const { shareConfig, shareData } = useMemo(() => {
    const config: ChartConfig = {}
    const data = rows.slice(0, TOP_SERIES + 4).map((stat, i) => {
      config[label(stat.key)] = {
        label: label(stat.key),
        color: chartColor(i),
      }
      return {
        name: label(stat.key),
        cost: stat.cost,
        fill: chartColor(i),
      }
    })
    return { shareConfig: config, shareData: data }
  }, [rows, label])

  const { areaConfig, areaData, areaKeys } = useMemo(() => {
    const points = dailyByKey.data ?? []
    const totals = new Map<string, number>()
    for (const p of points) {
      totals.set(p.key, (totals.get(p.key) ?? 0) + p.cost)
    }
    const top = [...totals.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, TOP_SERIES)
      .map(([key]) => key)
    const keySet = new Set(top)
    const byDate = new Map<string, Record<string, number | string>>()
    for (const p of points) {
      const row = byDate.get(p.date) ?? { date: p.date }
      const key = keySet.has(p.key) ? label(p.key) : "other"
      row[key] = (Number(row[key]) || 0) + p.cost
      byDate.set(p.date, row)
    }
    const keys = [...top.map(label), "other"]
    const config: ChartConfig = {}
    keys.forEach((key, i) => {
      config[key] = { label: key, color: chartColor(i) }
    })
    const areaData = [...byDate.values()]
    for (const row of areaData) {
      for (const key of keys) {
        if (row[key] === undefined) row[key] = 0
      }
    }
    return {
      areaConfig: config,
      areaData,
      areaKeys: keys,
    }
  }, [dailyByKey.data, label])

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 xl:grid-cols-5">
        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle>Cost share</CardTitle>
            <CardDescription>Total spend by {groupBy}</CardDescription>
          </CardHeader>
          <CardContent className="flex items-center gap-4">
            <ChartContainer
              config={shareConfig}
              className="aspect-square h-56 shrink-0"
            >
              <PieChart>
                <ChartTooltip
                  content={
                    <ChartTooltipContent
                      formatter={(value, name) => (
                        <div className="flex w-full items-center justify-between gap-2">
                          <span>{name}</span>
                          <span className="font-mono tabular-nums">
                            {formatCost(Number(value))}
                          </span>
                        </div>
                      )}
                    />
                  }
                />
                <Pie
                  data={shareData}
                  dataKey="cost"
                  nameKey="name"
                  innerRadius={55}
                  strokeWidth={2}
                >
                  <Label
                    content={({ viewBox }) => {
                      if (!viewBox || !("cx" in viewBox) || !("cy" in viewBox)) {
                        return null
                      }
                      return (
                        <text
                          x={viewBox.cx}
                          y={viewBox.cy}
                          textAnchor="middle"
                          dominantBaseline="middle"
                        >
                          <tspan
                            x={viewBox.cx}
                            y={viewBox.cy}
                            className="fill-foreground text-xl font-bold"
                          >
                            {formatCost(totalCost)}
                          </tspan>
                          <tspan
                            x={viewBox.cx}
                            y={(viewBox.cy ?? 0) + 20}
                            className="fill-muted-foreground text-xs"
                          >
                            total
                          </tspan>
                        </text>
                      )
                    }}
                  />
                </Pie>
              </PieChart>
            </ChartContainer>
            <div className="flex min-w-0 flex-1 flex-col justify-center gap-1.5">
              {shareData.map((entry) => (
                <div key={entry.name} className="flex items-center gap-2 text-sm">
                  <span
                    className="size-2.5 shrink-0 rounded-xs"
                    style={{ background: entry.fill }}
                  />
                  <span className="truncate">{entry.name}</span>
                  <span className="ml-auto font-mono text-xs tabular-nums text-muted-foreground">
                    {totalCost > 0
                      ? `${((entry.cost / totalCost) * 100).toFixed(1)}%`
                      : "—"}
                  </span>
                  <span className="w-16 text-right font-mono text-xs tabular-nums">
                    {formatCost(entry.cost)}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card className="xl:col-span-3">
          <CardHeader>
            <CardTitle>Daily cost by {groupBy}</CardTitle>
            <CardDescription>Top {TOP_SERIES} + other, stacked</CardDescription>
          </CardHeader>
          <CardContent>
            <ChartContainer config={areaConfig} className="h-72 w-full">
              <AreaChart data={areaData} accessibilityLayer>
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
                      formatter={(value, name, item) => (
                        <div className="flex w-full items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5">
                            <div
                              className="size-2 rounded-xs"
                              style={{ background: item.color }}
                            />
                            {name}
                          </div>
                          <span className="font-mono tabular-nums">
                            {formatCost(Number(value))}
                          </span>
                        </div>
                      )}
                    />
                  }
                />
                {areaKeys.map((key, index) => (
                  <Area
                    key={key}
                    dataKey={key}
                    stackId="cost"
                    type="monotone"
                    fill={chartColor(index)}
                    fillOpacity={0.65}
                    stroke={chartColor(index)}
                  />
                ))}
              </AreaChart>
            </ChartContainer>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{title}</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{groupBy === "model" ? "Model" : "Agent"}</TableHead>
                <TableHead className="text-right">Cost</TableHead>
                <TableHead className="text-right">Tokens</TableHead>
                <TableHead className="text-right">Output</TableHead>
                <TableHead className="text-right">Reasoning</TableHead>
                <TableHead className="text-right">Messages</TableHead>
                <TableHead className="text-right">Sessions</TableHead>
                <TableHead className="text-right">p50 tok/s</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((stat) => (
                <TableRow key={stat.key}>
                  <TableCell className="max-w-64 truncate font-medium">
                    {label(stat.key)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatCost(stat.cost)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatTokens(totalTokens(stat))}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatTokens(stat.tokens.output)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatTokens(stat.tokens.reasoning)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatCount(stat.messages)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatCount(stat.sessions)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {stat.p50OutputTps ? stat.p50OutputTps.toFixed(1) : "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
