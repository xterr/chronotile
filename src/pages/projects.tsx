import { useMemo } from "react"
import { Pie, PieChart } from "recharts"

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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { CopyButton } from "@/components/copy-button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { useQuery } from "@/hooks/use-query"
import { api, type ProjectStat } from "@/lib/api"
import { chartColor, formatCost, formatCount, formatTokens } from "@/lib/format"
import { ProjectKindIcon } from "@/components/project-kind-icon"
import { basename, isDirectoryProject, projectDisplayName } from "@/lib/paths"
import { useDashboard } from "@/state/dashboard-context"

function projectLabel(project: ProjectStat): string {
  return projectDisplayName(project.name, project.worktree) || project.projectId
}

function totalTokens(project: ProjectStat): number {
  return (
    project.tokens.input +
    project.tokens.output +
    project.tokens.reasoning +
    project.tokens.cacheRead +
    project.tokens.cacheWrite
  )
}

export function ProjectsPage() {
  const { rangeArgs, activePath } = useDashboard()
  const enabled = activePath !== null
  const projects = useQuery(
    () => api.projectStats(rangeArgs),
    [rangeArgs],
    enabled
  )

  const rows = useMemo(() => projects.data ?? [], [projects.data])
  const { config, data } = useMemo(() => {
    const config: ChartConfig = {}
    const data = rows.slice(0, 9).map((project, i) => {
      const name = projectLabel(project)
      config[name] = { label: name, color: chartColor(i) }
      return { name, cost: project.cost, fill: chartColor(i) }
    })
    return { config, data }
  }, [rows])

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Cost by project</CardTitle>
          <CardDescription>Total spend per project</CardDescription>
        </CardHeader>
        <CardContent>
          <ChartContainer config={config} className="mx-auto h-72 w-full">
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
                data={data}
                dataKey="cost"
                nameKey="name"
                innerRadius={55}
                strokeWidth={2}
                {...chartSeriesAnimation}
              />
              <ChartLegend content={<ChartLegendContent nameKey="name" />} />
            </PieChart>
          </ChartContainer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Projects</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Project</TableHead>
                <TableHead>Worktree</TableHead>
                <TableHead className="text-right">Cost</TableHead>
                <TableHead className="text-right">Tokens</TableHead>
                <TableHead className="text-right">Messages</TableHead>
                <TableHead className="text-right">Sessions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((project) => (
                <TableRow key={project.projectId}>
                  <TableCell className="font-medium">
                    <div className="flex items-center gap-1.5">
                      <ProjectKindIcon
                        directory={isDirectoryProject(project.projectId)}
                      />
                      {projectLabel(project)}
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    <div className="flex items-center gap-1">
                      <Tooltip>
                        <TooltipTrigger
                          render={<span>{basename(project.worktree)}</span>}
                        />
                        <TooltipContent>{project.worktree}</TooltipContent>
                      </Tooltip>
                      <CopyButton text={project.worktree} />
                    </div>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatCost(project.cost)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatTokens(totalTokens(project))}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatCount(project.messages)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatCount(project.sessions)}
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
