import { useMemo, useState } from "react"

import { SessionSheet } from "@/components/session-sheet"
import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { useQuery } from "@/hooks/use-query"
import { api, type SessionRow } from "@/lib/api"
import { formatCost, formatDate, formatTokens, modelLabel } from "@/lib/format"
import { sessionProjectName } from "@/lib/paths"
import { useDashboard } from "@/state/dashboard-context"

function parseModel(raw: string | null): string {
  if (!raw) return "—"
  try {
    const parsed = JSON.parse(raw) as { id?: string; providerID?: string }
    return parsed.id ?? raw
  } catch {
    return modelLabel(raw)
  }
}

export function SessionsPage() {
  const { rangeArgs, activePath } = useDashboard()
  const enabled = activePath !== null
  const [includeSubagents, setIncludeSubagents] = useState(false)
  const [search, setSearch] = useState("")
  const [openSession, setOpenSession] = useState<SessionRow | null>(null)

  const sessions = useQuery(
    () => api.sessions({ ...rangeArgs, includeSubagents, limit: 500 }),
    [rangeArgs, includeSubagents],
    enabled,
  )

  const rows = useMemo(() => {
    const all = sessions.data ?? []
    if (!search.trim()) return all
    const needle = search.toLowerCase()
    return all.filter(
      (s) =>
        s.title.toLowerCase().includes(needle) ||
        s.projectName.toLowerCase().includes(needle) ||
        (s.agent ?? "").toLowerCase().includes(needle),
    )
  }, [sessions.data, search])

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sessions</CardTitle>
        <CardDescription>
          {rows.length} sessions in range (max 500)
        </CardDescription>
        <div className="flex items-center gap-2 pt-2">
          <Input
            placeholder="Filter by title, project or agent…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="max-w-sm"
          />
          <ToggleGroup
            variant="outline"
            size="sm"
            value={[includeSubagents ? "all" : "top"]}
            onValueChange={(value: string[]) => {
              const next = value[0]
              if (next) setIncludeSubagents(next === "all")
            }}
          >
            <ToggleGroupItem value="top">Top-level</ToggleGroupItem>
            <ToggleGroupItem value="all">All</ToggleGroupItem>
          </ToggleGroup>
        </div>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Title</TableHead>
              <TableHead>Project</TableHead>
              <TableHead>Agent</TableHead>
              <TableHead>Model</TableHead>
              <TableHead className="text-right">Cost</TableHead>
              <TableHead className="text-right">Tokens</TableHead>
              <TableHead className="text-right">Files</TableHead>
              <TableHead className="text-right">Updated</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((session) => (
              <TableRow
                key={`${session.profile}-${session.id}`}
                className="cursor-pointer"
                onClick={() => setOpenSession(session)}
              >
                <TableCell className="max-w-80 truncate font-medium">
                  {session.isSubagent && (
                    <Badge variant="secondary" className="mr-1.5">
                      sub
                    </Badge>
                  )}
                  {session.title || session.id}
                </TableCell>
                <TableCell className="max-w-48 truncate text-muted-foreground">
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <span>
                          {sessionProjectName(
                            session.projectName,
                            session.directory,
                          )}
                        </span>
                      }
                    />
                    <TooltipContent>{session.directory}</TooltipContent>
                  </Tooltip>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {session.agent ?? "—"}
                </TableCell>
                <TableCell className="max-w-44 truncate text-muted-foreground">
                  {parseModel(session.model)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatCost(session.cost)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatTokens(session.totalTokens)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {session.summaryFiles ?? "—"}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatDate(session.timeUpdated)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
      <SessionSheet
        session={openSession}
        dbPath={activePath}
        onClose={() => setOpenSession(null)}
      />
    </Card>
  )
}
