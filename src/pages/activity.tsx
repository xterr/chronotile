import { useMemo } from "react"
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts"

import { PunchCard } from "@/components/punch-card"
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
import { api } from "@/lib/api"
import { useDashboard } from "@/state/dashboard-context"

const activityConfig = {
  messages: { label: "Messages", color: "var(--chart-1)" },
  sessions: { label: "Sessions", color: "var(--chart-2)" },
} satisfies ChartConfig

export function ActivityPage() {
  const { rangeArgs, activePath } = useDashboard()
  const enabled = activePath !== null
  const daily = useQuery(() => api.dailySeries(rangeArgs), [rangeArgs], enabled)
  const hourly = useQuery(() => api.hourlyActivity(rangeArgs), [rangeArgs], enabled)

  const rows = useMemo(
    () =>
      (daily.data ?? []).map((d) => ({
        date: d.date,
        messages: d.messages,
        sessions: d.sessions,
      })),
    [daily.data],
  )

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Messages & sessions per day</CardTitle>
          <CardDescription>Assistant responses and distinct sessions</CardDescription>
        </CardHeader>
        <CardContent>
          <ChartContainer config={activityConfig} className="h-72 w-full">
            <BarChart data={rows} accessibilityLayer>
              <CartesianGrid vertical={false} />
              <XAxis
                dataKey="date"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                tickFormatter={(value: string) => value.slice(5)}
              />
              <YAxis tickLine={false} axisLine={false} width={40} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Bar
                dataKey="messages"
                fill="var(--color-messages)"
                radius={2}
                {...chartSeriesAnimation}
              />
              <Bar
                dataKey="sessions"
                fill="var(--color-sessions)"
                radius={2}
                {...chartSeriesAnimation}
              />
            </BarChart>
          </ChartContainer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Working hours</CardTitle>
          <CardDescription>Assistant messages by weekday and hour</CardDescription>
        </CardHeader>
        <CardContent>
          <PunchCard cells={hourly.data ?? []} />
        </CardContent>
      </Card>
    </div>
  )
}
