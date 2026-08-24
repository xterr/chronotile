import { Fragment, useMemo, useState } from "react"
import { ChevronRight } from "lucide-react"
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

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { useQuery } from "@tanstack/react-query"
import { api, type GroupStat } from "@/lib/api"
import { chartColor, formatCost, formatCount, formatTokens } from "@/lib/format"
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

function groupLabel(stat: GroupStat): string {
  return stat.provider ? `${stat.provider}/${stat.key}` : stat.key
}

function StatCells({ stat }: { stat: GroupStat }) {
  return (
    <>
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
    </>
  )
}

export function GroupBreakdown({ groupBy, title }: GroupBreakdownProps) {
  const { rangeArgs, activePath } = useDashboard()
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const enabled = activePath !== null

  const toggle = (key: string) =>
    setExpanded((current) => {
      const next = new Set(current)
      if (!next.delete(key)) next.add(key)
      return next
    })
  const stats = useQuery({
    queryKey: ["groupStats", rangeArgs, groupBy],
    queryFn: () =>
      groupBy === "model"
        ? api.modelStats(rangeArgs)
        : api.agentStats(rangeArgs),
    enabled,
  })
  const dailyByKey = useQuery({
    queryKey: ["modelDaily", rangeArgs, groupBy],
    queryFn: () => api.modelDaily({ ...rangeArgs, groupBy }),
    enabled,
  })

  const rows = useMemo(() => stats.data ?? [], [stats.data])
  const totalCost = useMemo(
    () => rows.reduce((sum, row) => sum + row.cost, 0),
    [rows]
  )

  const { shareConfig, shareData } = useMemo(() => {
    const totals = new Map<string, number>()
    for (const stat of rows) {
      const name = groupLabel(stat)
      totals.set(name, (totals.get(name) ?? 0) + stat.cost)
    }
    const config: ChartConfig = {}
    const data = [...totals.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, TOP_SERIES + 4)
      .map(([name, cost], i) => {
        config[name] = {
          label: name,
          color: chartColor(i),
        }
        return {
          name,
          cost,
          fill: chartColor(i),
        }
      })
    return { shareConfig: config, shareData: data }
  }, [rows])

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
      const key = keySet.has(p.key) ? p.key : "other"
      row[key] = (Number(row[key]) || 0) + p.cost
      byDate.set(p.date, row)
    }
    const keys = [...top, "other"]
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
  }, [dailyByKey.data])

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 xl:grid-cols-5">
        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle>Cost share</CardTitle>
            <CardDescription>Total spend by {groupBy}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-1 items-center justify-center gap-4">
            <ChartContainer
              config={shareConfig}
              className={
                groupBy === "agent"
                  ? "aspect-square h-56 shrink-0"
                  : "aspect-square h-72 shrink-0"
              }
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
                  {...chartSeriesAnimation}
                >
                  <Label
                    content={({ viewBox }) => {
                      if (
                        !viewBox ||
                        !("cx" in viewBox) ||
                        !("cy" in viewBox)
                      ) {
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
            {groupBy === "agent" && (
              <div className="flex min-w-0 flex-1 flex-col justify-center gap-1.5">
                {shareData.map((entry) => (
                  <div
                    key={entry.name}
                    className="flex items-center gap-2 text-sm"
                  >
                    <span
                      className="size-2.5 shrink-0 rounded-xs"
                      style={{ background: entry.fill }}
                    />
                    <Tooltip>
                      <TooltipTrigger
                        render={<span className="min-w-0 truncate" />}
                      >
                        {entry.name}
                      </TooltipTrigger>
                      <TooltipContent>{entry.name}</TooltipContent>
                    </Tooltip>
                    <span className="ml-auto font-mono text-xs text-muted-foreground tabular-nums">
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
            )}
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
                    {...chartSeriesAnimation}
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
              {rows.map((stat) => {
                const label = groupLabel(stat)
                const open = expanded.has(label)
                return (
                  <Fragment key={label}>
                    <TableRow>
                      <TableCell className="max-w-64 font-medium">
                        <div className="flex items-center gap-1.5">
                          {stat.variants.length > 0 ? (
                            <Button
                              variant="ghost"
                              size="icon-xs"
                              aria-expanded={open}
                              aria-label={`${open ? "Hide" : "Show"} variants of ${label}`}
                              onClick={() => toggle(label)}
                            >
                              <ChevronRight
                                className={`transition-transform duration-150 ${open ? "rotate-90" : ""}`}
                              />
                            </Button>
                          ) : (
                            <span className="size-6 shrink-0" />
                          )}
                          <Tooltip>
                            <TooltipTrigger
                              render={<span className="min-w-0 truncate" />}
                            >
                              {label}
                            </TooltipTrigger>
                            <TooltipContent>{label}</TooltipContent>
                          </Tooltip>
                          {stat.variant ? (
                            <Badge variant="secondary">{stat.variant}</Badge>
                          ) : null}
                          {stat.variants.length > 0 ? (
                            <span className="shrink-0 text-xs text-muted-foreground">
                              {stat.variants.length} variants
                            </span>
                          ) : null}
                        </div>
                      </TableCell>
                      <StatCells stat={stat} />
                    </TableRow>
                    {open
                      ? stat.variants.map((variant) => (
                          <TableRow
                            key={`${label}#${variant.variant ?? "default"}`}
                            className="bg-muted/20 text-muted-foreground"
                          >
                            <TableCell className="max-w-64 pl-9">
                              <Badge
                                variant="outline"
                                className="font-mono text-xs"
                              >
                                {variant.variant ?? "default"}
                              </Badge>
                            </TableCell>
                            <StatCells stat={variant} />
                          </TableRow>
                        ))
                      : null}
                  </Fragment>
                )
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
