import { useQuery } from "@tanstack/react-query"

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
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
import { api } from "@/lib/api"
import { formatCount } from "@/lib/format"
import { basename, middleTruncatePath } from "@/lib/paths"
import { useDashboard } from "@/state/dashboard-context"

function parentDir(path: string): string {
  const at = path.lastIndexOf("/")
  return at >= 0 ? path.slice(0, at) : ""
}

export function FilesPage() {
  const { rangeArgs, activePath } = useDashboard()
  const enabled = activePath !== null

  const files = useQuery({
    queryKey: ["fileStats", rangeArgs],
    queryFn: () => api.fileStats(rangeArgs),
    enabled,
  })

  const rows = files.data ?? []

  if (files.data && rows.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>No file activity</CardTitle>
          <CardDescription>
            File paths come from read, edit and write calls in the selected
            range.
          </CardDescription>
        </CardHeader>
      </Card>
    )
  }

  const busiest = rows[0]?.touches ?? 1

  return (
    <Card>
      <CardHeader>
        <CardTitle>Hot files</CardTitle>
        <CardDescription>
          Files the agent touched most, from read, edit and write calls
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>File</TableHead>
              <TableHead className="text-right">Reads</TableHead>
              <TableHead className="text-right">Edits</TableHead>
              <TableHead className="text-right">Writes</TableHead>
              <TableHead className="w-32 text-right">Touches</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.slice(0, 100).map((file) => (
              <TableRow key={file.path}>
                <TableCell>
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <div className="flex w-fit max-w-full flex-col gap-0.5">
                          <span className="font-medium">
                            {basename(file.path)}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {middleTruncatePath(parentDir(file.path), 2, 3)}
                          </span>
                        </div>
                      }
                    />
                    <TooltipContent className="max-w-xl break-all">
                      {file.path}
                    </TooltipContent>
                  </Tooltip>
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatCount(file.reads)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatCount(file.edits)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatCount(file.writes)}
                </TableCell>
                <TableCell>
                  <div className="flex items-center justify-end gap-2">
                    <div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-primary"
                        style={{
                          width: `${Math.max(2, (file.touches / busiest) * 100).toFixed(1)}%`,
                        }}
                      />
                    </div>
                    <span className="tabular-nums">
                      {formatCount(file.touches)}
                    </span>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}
