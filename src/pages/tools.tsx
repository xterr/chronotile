import { useMemo } from "react"
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts"

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
import { useQuery } from "@tanstack/react-query"
import { api } from "@/lib/api"
import { formatCount, formatDuration } from "@/lib/format"
import { useDashboard } from "@/state/dashboard-context"

const callsConfig = {
  calls: { label: "Calls", color: "var(--chart-1)" },
  errors: { label: "Errors", color: "var(--chart-5)" },
} satisfies ChartConfig

const TOP_TOOLS = 15

export function ToolsPage() {
  const { rangeArgs, activePath } = useDashboard()
  const enabled = activePath !== null
  const redundancy = useQuery({
    queryKey: ["redundancy", rangeArgs],
    queryFn: () => api.redundancy(rangeArgs),
    enabled,
  })
  const tools = useQuery({
    queryKey: ["toolStats", rangeArgs],
    queryFn: () => api.toolStats(rangeArgs),
    enabled,
  })

  const rows = useMemo(() => tools.data ?? [], [tools.data])
  const chartRows = useMemo(() => rows.slice(0, TOP_TOOLS), [rows])

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Tool calls</CardTitle>
          <CardDescription>Top {TOP_TOOLS} tools by call count</CardDescription>
        </CardHeader>
        <CardContent>
          <ChartContainer config={callsConfig} className="h-80 w-full">
            <BarChart data={chartRows} layout="vertical" accessibilityLayer>
              <CartesianGrid horizontal={false} />
              <XAxis type="number" tickLine={false} axisLine={false} />
              <YAxis
                dataKey="tool"
                type="category"
                tickLine={false}
                axisLine={false}
                width={180}
              />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Bar
                dataKey="calls"
                fill="var(--color-calls)"
                radius={2}
                {...chartSeriesAnimation}
              />
              <Bar
                dataKey="errors"
                fill="var(--color-errors)"
                radius={2}
                {...chartSeriesAnimation}
              />
            </BarChart>
          </ChartContainer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>All tools</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tool</TableHead>
                <TableHead className="text-right">Calls</TableHead>
                <TableHead className="text-right">Completed</TableHead>
                <TableHead className="text-right">Errors</TableHead>
                <TableHead className="text-right">Error rate</TableHead>
                <TableHead className="text-right">p50</TableHead>
                <TableHead className="text-right">p95</TableHead>
                <TableHead className="text-right">Total time</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((tool) => (
                <TableRow key={tool.tool}>
                  <TableCell className="max-w-64 truncate font-medium">
                    {tool.tool}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatCount(tool.calls)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatCount(tool.completed)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatCount(tool.errors)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {tool.calls > 0
                      ? `${((tool.errors / tool.calls) * 100).toFixed(1)}%`
                      : "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {tool.p50DurationMs != null
                      ? formatDuration(tool.p50DurationMs)
                      : "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {tool.p95DurationMs != null
                      ? formatDuration(tool.p95DurationMs)
                      : "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatDuration(tool.totalDurationMs)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      {redundancy.data && redundancy.data.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Repeated calls</CardTitle>
            <CardDescription>
              Identical arguments issued three or more times inside one session —
              usually an agent going in circles
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tool</TableHead>
                  <TableHead className="text-right">Repeated</TableHead>
                  <TableHead className="text-right">Sessions</TableHead>
                  <TableHead className="text-right">Share of calls</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {redundancy.data.slice(0, 15).map((row) => (
                  <TableRow key={row.tool}>
                    <TableCell className="font-medium">{row.tool}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatCount(row.repeatedCalls)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatCount(row.sessions)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.calls > 0
                        ? `${((row.repeatedCalls / row.calls) * 100).toFixed(1)}%`
                        : "—"}
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