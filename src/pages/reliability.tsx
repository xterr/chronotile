import { useMemo } from "react"
import { Pie, PieChart } from "recharts"

import { StatCard } from "@/components/stat-card"
import { Badge } from "@/components/ui/badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  chartSeriesAnimation,
  type ChartConfig,
} from "@/components/ui/chart"
import { useQuery } from "@tanstack/react-query"
import { api } from "@/lib/api"
import { chartColor, formatCount, formatPercent } from "@/lib/format"
import { useDashboard } from "@/state/dashboard-context"

export function ReliabilityPage() {
  const { rangeArgs, activePath } = useDashboard()
  const enabled = activePath !== null
  const report = useQuery({
    queryKey: ["reliability", rangeArgs],
    queryFn: () => api.reliability(rangeArgs),
    enabled,
  })
  const overview = useQuery({
    queryKey: ["overview", rangeArgs],
    queryFn: () => api.overview(rangeArgs),
    enabled,
  })
  const context = useQuery({
    queryKey: ["contextHealth", activePath],
    queryFn: () => api.contextHealth(activePath ? [activePath] : []),
    enabled,
  })
  const details = useQuery({
    queryKey: ["errorDetails", rangeArgs],
    queryFn: () => api.errorDetails(rangeArgs),
    enabled,
  })

  const data = report.data
  const totalErrors = data?.errors.reduce((sum, e) => sum + e.count, 0) ?? 0
  const errorRate =
    overview.data && overview.data.messages > 0
      ? (totalErrors / overview.data.messages) * 100
      : null

  const { config, chartData } = useMemo(() => {
    const config: ChartConfig = {}
    const chartData = (data?.errors ?? []).map((error, i) => {
      config[error.name] = { label: error.name, color: chartColor(i) }
      return { name: error.name, count: error.count, fill: chartColor(i) }
    })
    return { config, chartData }
  }, [data?.errors])

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <StatCard
          label="Errored messages"
          value={data ? formatCount(totalErrors) : null}
        />
        <StatCard
          label="Error rate"
          value={errorRate !== null ? `${errorRate.toFixed(2)}%` : null}
          hint="of assistant messages"
        />
        <StatCard
          label="Auto compactions"
          value={data ? formatCount(data.compactionsAuto) : null}
        />
        <StatCard
          label="Overflow compactions"
          value={data ? formatCount(data.compactionsOverflow) : null}
        />
        <StatCard
          label="Retries"
          value={data ? formatCount(data.retries) : null}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Error breakdown</CardTitle>
          <CardDescription>Assistant message errors by type</CardDescription>
        </CardHeader>
        <CardContent>
          {chartData.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">
              No errors in the selected range.
            </p>
          ) : (
            <ChartContainer config={config} className="mx-auto h-72 w-full">
              <PieChart>
                <ChartTooltip content={<ChartTooltipContent />} />
                <Pie
                  data={chartData}
                  dataKey="count"
                  nameKey="name"
                  innerRadius={55}
                  strokeWidth={2}
                  {...chartSeriesAnimation}
                />
                <ChartLegend content={<ChartLegendContent nameKey="name" />} />
              </PieChart>
            </ChartContainer>
          )}
        </CardContent>
      </Card>
      {context.data && context.data.messages > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Context window pressure</CardTitle>
            <CardDescription>
              How full each prompt was against its model's limit, over the last{" "}
              {context.data.windowDays} days
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <StatCard
                label="Median prompt"
                value={formatPercent(context.data.p50)}
                hint="of the window"
              />
              <StatCard
                label="p95 prompt"
                value={formatPercent(context.data.p95)}
                hint="1 in 20 is larger"
              />
              <StatCard
                label="Largest prompt"
                value={formatPercent(context.data.max)}
              />
              <StatCard
                label={`Above ${formatPercent(context.data.nearLimitFraction)}`}
                value={formatCount(context.data.nearLimit)}
                hint="messages at risk of context rot"
              />
            </div>
            <span className="text-xs text-muted-foreground">
              Accuracy tends to fall off well before a model's advertised limit,
              so prompts above {formatPercent(context.data.nearLimitFraction)} are
              worth trimming or compacting rather than left to run.
            </span>
          </CardContent>
        </Card>
      ) : null}
      {details.data && details.data.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>What actually failed</CardTitle>
            <CardDescription>
              Most frequent failures, with the message opencode recorded
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-28">Source</TableHead>
                  <TableHead className="w-44">Name</TableHead>
                  <TableHead>Message</TableHead>
                  <TableHead className="text-right">Count</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {details.data.slice(0, 25).map((detail, index) => (
                  <TableRow key={index}>
                    <TableCell>
                      <Badge variant="outline">{detail.scope}</Badge>
                    </TableCell>
                    <TableCell className="font-medium">{detail.name}</TableCell>
                    <TableCell className="text-muted-foreground">
                      <span className="line-clamp-2 font-mono text-xs">
                        {detail.message || "—"}
                      </span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatCount(detail.count)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}