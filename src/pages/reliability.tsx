import { useMemo } from "react"
import { Pie, PieChart } from "recharts"

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
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart"
import { useQuery } from "@/hooks/use-query"
import { api } from "@/lib/api"
import { chartColor, formatCount } from "@/lib/format"
import { useDashboard } from "@/state/dashboard-context"

export function ReliabilityPage() {
  const { rangeArgs, activePath } = useDashboard()
  const enabled = activePath !== null
  const report = useQuery(() => api.reliability(rangeArgs), [rangeArgs], enabled)
  const overview = useQuery(() => api.overview(rangeArgs), [rangeArgs], enabled)

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
        <StatCard label="Retries" value={data ? formatCount(data.retries) : null} />
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
                />
                <ChartLegend content={<ChartLegendContent nameKey="name" />} />
              </PieChart>
            </ChartContainer>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
