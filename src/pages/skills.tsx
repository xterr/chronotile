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
import { formatCount, formatDate } from "@/lib/format"
import { useDashboard } from "@/state/dashboard-context"

const loadsConfig = {
  viaTask: { label: "Preloaded by task", color: "var(--chart-1)" },
  direct: { label: "Invoked directly", color: "var(--chart-3)" },
} satisfies ChartConfig

const TOP_SKILLS = 15

export function SkillsPage() {
  const { rangeArgs, activePath } = useDashboard()
  const enabled = activePath !== null
  const skills = useQuery({
    queryKey: ["skillStats", rangeArgs],
    queryFn: () => api.skillStats(rangeArgs),
    enabled,
  })

  const rows = useMemo(() => skills.data ?? [], [skills.data])
  const chartRows = useMemo(() => rows.slice(0, TOP_SKILLS), [rows])

  if (!skills.isLoading && rows.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Skills</CardTitle>
          <CardDescription>
            No skill usage recorded in this range. Skills are counted when an
            agent preloads them into a task or invokes one directly.
          </CardDescription>
        </CardHeader>
      </Card>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Skill loads</CardTitle>
          <CardDescription>
            Top {TOP_SKILLS} skills by number of loads
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ChartContainer config={loadsConfig} className="h-80 w-full">
            <BarChart data={chartRows} layout="vertical" accessibilityLayer>
              <CartesianGrid horizontal={false} />
              <XAxis type="number" tickLine={false} axisLine={false} />
              <YAxis
                dataKey="skill"
                type="category"
                tickLine={false}
                axisLine={false}
                interval={0}
                width={220}
              />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Bar
                dataKey="viaTask"
                stackId="loads"
                fill="var(--color-viaTask)"
                radius={2}
                {...chartSeriesAnimation}
              />
              <Bar
                dataKey="direct"
                stackId="loads"
                fill="var(--color-direct)"
                radius={2}
                {...chartSeriesAnimation}
              />
            </BarChart>
          </ChartContainer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>All skills</CardTitle>
          <CardDescription>
            {formatCount(rows.length)} skills used in this range
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Skill</TableHead>
                <TableHead className="text-right">Loads</TableHead>
                <TableHead className="text-right">Via task</TableHead>
                <TableHead className="text-right">Direct</TableHead>
                <TableHead className="text-right">Sessions</TableHead>
                <TableHead className="text-right">Projects</TableHead>
                <TableHead className="text-right">First used</TableHead>
                <TableHead className="text-right">Last used</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((skill) => (
                <TableRow key={skill.skill}>
                  <TableCell className="max-w-64 truncate font-medium">
                    {skill.skill}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatCount(skill.loads)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatCount(skill.viaTask)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatCount(skill.direct)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatCount(skill.sessions)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatCount(skill.projects)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatDate(skill.firstUsed)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatDate(skill.lastUsed)}
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
