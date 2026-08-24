import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useInfiniteQuery } from "@tanstack/react-query"
import { ChevronRight, LoaderCircle } from "lucide-react"

import { SessionSheet } from "@/components/session-sheet"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
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
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  api,
  type RangeArgs,
  type SessionCursor,
  type SessionRow,
} from "@/lib/api"
import {
  formatCost,
  formatCount,
  formatDate,
  formatTokens,
  modelLabel,
} from "@/lib/format"
import { sessionProjectName } from "@/lib/paths"
import { useDashboard } from "@/state/dashboard-context"

const ROOT_PAGE = 50
const INLINE_CHILDREN = 20
const CHILD_PAGE = 100
const SEARCH_PAGE = 100
const SEARCH_DEBOUNCE = 250
const INDENT = 20
const COLUMNS = 8

interface ModelInfo {
  label: string
  variant: string | null
}

function parseModel(raw: string | null): ModelInfo {
  if (!raw) return { label: "—", variant: null }
  try {
    const parsed = JSON.parse(raw) as {
      id?: string
      providerID?: string
      variant?: string
    }
    const label =
      parsed.providerID && parsed.id
        ? `${parsed.providerID}/${parsed.id}`
        : (parsed.id ?? raw)
    const variant =
      parsed.variant && parsed.variant !== "default" ? parsed.variant : null
    return { label, variant }
  } catch {
    return { label: modelLabel(raw), variant: null }
  }
}

type FlatRow =
  | { kind: "session"; session: SessionRow; depth: number }
  | { kind: "more"; parent: SessionRow; depth: number; remaining: number }

export function SessionsPage() {
  const { rangeArgs, activePath } = useDashboard()
  const [search, setSearch] = useState("")
  const [query, setQuery] = useState("")

  useEffect(() => {
    const timer = setTimeout(() => setQuery(search), SEARCH_DEBOUNCE)
    return () => clearTimeout(timer)
  }, [search])

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sessions</CardTitle>
        <CardDescription>
          Conversations with their subagents nested underneath
        </CardDescription>
        <div className="flex items-center gap-2 pt-2">
          <Input
            placeholder="Search all sessions by title, project or agent…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="max-w-sm"
          />
        </div>
      </CardHeader>
      {activePath && (
        <SessionsBrowser
          key={`${activePath}|${rangeArgs.from ?? ""}|${rangeArgs.project ?? ""}|${query}`}
          rangeArgs={rangeArgs}
          query={query}
          activePath={activePath}
        />
      )}
    </Card>
  )
}

interface SessionsBrowserProps {
  rangeArgs: RangeArgs
  query: string
  activePath: string
}

function SessionsBrowser({
  rangeArgs,
  query,
  activePath,
}: SessionsBrowserProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [extra, setExtra] = useState<Map<string, SessionRow[]>>(new Map())
  const [openSession, setOpenSession] = useState<SessionRow | null>(null)
  const [focus, setFocus] = useState(0)
  const rowRefs = useRef<(HTMLTableRowElement | null)[]>([])

  const searching = query.trim().length > 0

  const {
    data,
    isFetching: loading,
    hasNextPage,
    fetchNextPage,
  } = useInfiniteQuery({
    queryKey: ["sessionRoots", rangeArgs, query],
    queryFn: ({ pageParam }) =>
      searching
        ? api.searchSessions({
            ...rangeArgs,
            query,
            cursor: pageParam ?? undefined,
            limit: SEARCH_PAGE,
          })
        : api.sessionRoots({
            ...rangeArgs,
            cursor: pageParam ?? undefined,
            limit: ROOT_PAGE,
            inlineChildren: INLINE_CHILDREN,
          }),
    initialPageParam: null as SessionCursor | null,
    getNextPageParam: (last) => last.nextCursor,
  })

  const rows = useMemo(
    () => data?.pages.flatMap((page) => page.rows) ?? [],
    [data]
  )
  const total = data?.pages[0]?.total ?? null

  const childrenOf = useCallback(
    (session: SessionRow) => [
      ...session.children,
      ...(extra.get(session.id) ?? []),
    ],
    [extra]
  )

  const loadChildren = useCallback(
    async (session: SessionRow) => {
      const loaded = childrenOf(session)
      const last = loaded[loaded.length - 1]
      const page = await api.sessionChildren({
        dbPaths: rangeArgs.dbPaths,
        parentId: session.id,
        cursor: last
          ? { timeUpdated: last.timeUpdated, id: last.id }
          : undefined,
        limit: CHILD_PAGE,
      })
      setExtra((current) => {
        const next = new Map(current)
        next.set(session.id, [...(next.get(session.id) ?? []), ...page.rows])
        return next
      })
    },
    [childrenOf, rangeArgs.dbPaths]
  )

  const toggle = useCallback(
    (session: SessionRow) => {
      const willOpen = !expanded.has(session.id)
      setExpanded((current) => {
        const next = new Set(current)
        if (!next.delete(session.id)) next.add(session.id)
        return next
      })
      if (
        willOpen &&
        session.children.length === 0 &&
        !extra.has(session.id) &&
        session.childCount > 0
      ) {
        void loadChildren(session)
      }
    },
    [expanded, extra, loadChildren]
  )

  const flat = useMemo(() => {
    if (searching) {
      return rows.map((session): FlatRow => ({
        kind: "session",
        session,
        depth: 0,
      }))
    }
    const out: FlatRow[] = []
    const walk = (list: SessionRow[], depth: number) => {
      for (const session of list) {
        out.push({ kind: "session", session, depth })
        if (!expanded.has(session.id)) continue
        const kids = childrenOf(session)
        walk(kids, depth + 1)
        const remaining = session.childCount - kids.length
        if (remaining > 0) {
          out.push({
            kind: "more",
            parent: session,
            depth: depth + 1,
            remaining,
          })
        }
      }
    }
    walk(rows, 0)
    return out
  }, [rows, expanded, childrenOf, searching])

  const move = (start: number, direction: number) => {
    let index = start
    while (
      index >= 0 &&
      index < flat.length &&
      flat[index].kind !== "session"
    ) {
      index += direction
    }
    if (index < 0 || index >= flat.length) return
    setFocus(index)
    rowRefs.current[index]?.focus()
  }

  const onKeyDown = (event: React.KeyboardEvent, index: number) => {
    const item = flat[index]
    if (item.kind !== "session") return
    const session = item.session
    const isOpen = expanded.has(session.id)
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault()
        move(index + 1, 1)
        break
      case "ArrowUp":
        event.preventDefault()
        move(index - 1, -1)
        break
      case "ArrowRight":
        event.preventDefault()
        if (session.childCount > 0 && !isOpen) toggle(session)
        else move(index + 1, 1)
        break
      case "ArrowLeft": {
        event.preventDefault()
        if (isOpen) {
          toggle(session)
          break
        }
        for (let i = index - 1; i >= 0; i--) {
          const candidate = flat[i]
          if (candidate.kind === "session" && candidate.depth < item.depth) {
            move(i, -1)
            break
          }
        }
        break
      }
      case "Enter":
      case " ":
        event.preventDefault()
        setOpenSession(session)
        break
    }
  }

  const caption = searching
    ? `${formatCount(rows.length)} matching sessions`
    : total !== null
      ? `${formatCount(rows.length)} of ${formatCount(total)} conversations`
      : `${formatCount(rows.length)} conversations`

  return (
    <CardContent>
      <div className="flex items-center gap-2 pb-2 text-sm text-muted-foreground">
        <span>{caption}</span>
        {searching && <span>· flat list while searching</span>}
        {loading && <LoaderCircle className="size-3.5 animate-spin" />}
      </div>
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
          {flat.map((item, index) => {
            if (item.kind === "more") {
              return (
                <TableRow key={`more-${item.parent.id}-${item.remaining}`}>
                  <TableCell colSpan={COLUMNS}>
                    <div style={{ paddingLeft: item.depth * INDENT + 30 }}>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => void loadChildren(item.parent)}
                      >
                        Show {formatCount(item.remaining)} more
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              )
            }
            const session = item.session
            const isOpen = expanded.has(session.id)
            const model = parseModel(session.model)
            return (
              <TableRow
                key={`${session.profile}-${session.id}`}
                ref={(element) => {
                  rowRefs.current[index] = element
                }}
                tabIndex={index === focus ? 0 : -1}
                className="cursor-pointer outline-none focus-visible:bg-accent"
                onFocus={() => setFocus(index)}
                onKeyDown={(event) => onKeyDown(event, index)}
                onClick={() => setOpenSession(session)}
              >
                <TableCell className="max-w-96">
                  <div
                    className="flex items-center gap-1"
                    style={{ paddingLeft: item.depth * INDENT }}
                  >
                    {!searching && session.childCount > 0 ? (
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        aria-expanded={isOpen}
                        aria-label={`${isOpen ? "Collapse" : "Expand"} ${session.title || session.id}`}
                        onClick={(event) => {
                          event.stopPropagation()
                          toggle(session)
                        }}
                      >
                        <ChevronRight
                          className={`transition-transform duration-150 ${isOpen ? "rotate-90" : ""}`}
                        />
                      </Button>
                    ) : (
                      <span className="size-6 shrink-0" />
                    )}
                    {searching && session.isSubagent && (
                      <Badge variant="secondary" className="shrink-0">
                        sub
                      </Badge>
                    )}
                    <span className="truncate font-medium">
                      {session.title || session.id}
                    </span>
                    {session.childCount > 0 && (
                      <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                        {formatCount(session.childCount)}
                      </span>
                    )}
                  </div>
                </TableCell>
                <TableCell className="max-w-48 truncate text-muted-foreground">
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <span>
                          {sessionProjectName(
                            session.projectName,
                            session.directory
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
                <TableCell className="max-w-56 text-muted-foreground">
                  <div className="flex items-center gap-1.5">
                    <span className="min-w-0 truncate">{model.label}</span>
                    {model.variant && (
                      <Badge
                        variant="outline"
                        className="shrink-0 font-mono text-xs"
                      >
                        {model.variant}
                      </Badge>
                    )}
                  </div>
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
            )
          })}
          {flat.length === 0 && !loading && (
            <TableRow>
              <TableCell
                colSpan={COLUMNS}
                className="py-8 text-center text-sm text-muted-foreground"
              >
                {searching
                  ? "No sessions match your search."
                  : "No sessions in the selected range."}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
      {hasNextPage && (
        <div className="flex justify-center pt-4">
          <Button
            variant="outline"
            size="sm"
            disabled={loading}
            onClick={() => void fetchNextPage()}
          >
            {loading ? <LoaderCircle className="animate-spin" /> : null}
            Load more
          </Button>
        </div>
      )}
      <SessionSheet
        session={openSession}
        dbPath={activePath}
        onClose={() => setOpenSession(null)}
      />
    </CardContent>
  )
}
