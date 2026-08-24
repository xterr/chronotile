import { AlertCircle, Bot, FileDiff, User, Wrench } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Skeleton } from "@/components/ui/skeleton"
import { useInfiniteQuery } from "@tanstack/react-query"
import { api, type PartView, type SessionRow } from "@/lib/api"
import {
  formatCost,
  formatCount,
  formatDuration,
  formatTokens,
} from "@/lib/format"

/** Messages per page. */
const PAGE_SIZE = 50

interface SessionSheetProps {
  session: SessionRow | null
  dbPath: string | null
  onClose: () => void
}

function ToolPart({ part }: { part: PartView }) {
  return (
    <div className="flex items-center gap-2 rounded-md bg-muted/60 px-2 py-1 text-xs">
      <Wrench className="size-3 shrink-0 text-muted-foreground" />
      <span className="font-medium">{part.tool}</span>
      {part.title && (
        <span className="truncate text-muted-foreground">{part.title}</span>
      )}
      <span className="ml-auto flex shrink-0 items-center gap-2">
        {part.status === "error" && (
          <Badge variant="destructive" className="h-4 px-1 text-[10px]">
            error
          </Badge>
        )}
        {part.durationMs !== null && (
          <span className="text-muted-foreground tabular-nums">
            {formatDuration(part.durationMs)}
          </span>
        )}
      </span>
    </div>
  )
}

function MessagePart({ part }: { part: PartView }) {
  if (part.kind === "tool") return <ToolPart part={part} />
  if (part.kind === "patch") {
    return (
      <div className="flex items-center gap-2 rounded-md bg-muted/60 px-2 py-1 text-xs text-muted-foreground">
        <FileDiff className="size-3 shrink-0" />
        {part.files ?? 0} file{(part.files ?? 0) === 1 ? "" : "s"} changed
      </div>
    )
  }
  if (part.kind === "reasoning") {
    return (
      <div className="border-l-2 border-muted pl-2 text-xs text-muted-foreground italic">
        <p className="whitespace-pre-wrap">{part.text}</p>
        {part.truncated && <span className="not-italic">…</span>}
      </div>
    )
  }
  return (
    <div className="text-sm">
      <p className="whitespace-pre-wrap">{part.text}</p>
      {part.truncated && (
        <span className="text-muted-foreground">… truncated</span>
      )}
    </div>
  )
}

export function SessionSheet({ session, dbPath, onClose }: SessionSheetProps) {
  const enabled = session !== null && dbPath !== null
  const detail = useInfiniteQuery({
    queryKey: ["sessionDetail", dbPath, session?.id],
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      api.sessionDetail(dbPath ?? "", session?.id ?? "", pageParam, PAGE_SIZE),
    getNextPageParam: (last, pages) =>
      last.hasMore ? pages.length * PAGE_SIZE : undefined,
    enabled,
  })

  const messages = detail.data?.pages.flatMap((page) => page.messages) ?? []
  const total = detail.data?.pages[0]?.total ?? 0

  return (
    <Sheet
      open={session !== null}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <SheetContent
        side="right"
        className="flex flex-col gap-0 data-[side=right]:sm:max-w-5xl"
      >
        <SheetHeader className="border-b">
          <SheetTitle className="pr-8 leading-snug">
            {session?.title || session?.id}
          </SheetTitle>
          <SheetDescription>
            {session && (
              <>
                {formatCost(session.cost)} · {formatTokens(session.totalTokens)}{" "}
                tokens · {formatCount(total)} messages
              </>
            )}
          </SheetDescription>
        </SheetHeader>
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
          {detail.isLoading && (
            <div className="flex flex-col gap-3">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-16 w-full" />
            </div>
          )}
          {detail.error && (
            <p className="text-sm text-destructive">{String(detail.error)}</p>
          )}
          {!detail.isLoading &&
            messages.map((message) => (
              <div key={message.id} className="flex flex-col gap-1.5">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  {message.role === "user" ? (
                    <User className="size-3.5 text-primary" />
                  ) : (
                    <Bot className="size-3.5" />
                  )}
                  <span className="font-medium text-foreground">
                    {message.role === "user"
                      ? "You"
                      : (message.model ?? "assistant")}
                  </span>
                  {message.agent && message.role === "assistant" && (
                    <Badge variant="secondary" className="h-4 px-1 text-[10px]">
                      {message.agent}
                    </Badge>
                  )}
                  <span className="ml-auto flex items-center gap-2 tabular-nums">
                    {message.role === "assistant" && message.cost > 0 && (
                      <span>{formatCost(message.cost)}</span>
                    )}
                    {new Date(message.timeCreated).toLocaleTimeString("en-US", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </div>
                {message.error && (
                  <div className="flex items-center gap-1.5 text-xs text-destructive">
                    <AlertCircle className="size-3" />
                    {message.error}
                  </div>
                )}
                <div
                  className={`flex flex-col gap-1.5 rounded-lg border p-3 ${
                    message.role === "user"
                      ? "border-primary/30 bg-primary/5"
                      : ""
                  }`}
                >
                  {message.parts.length === 0 ? (
                    <p className="text-xs text-muted-foreground italic">
                      no content
                    </p>
                  ) : (
                    message.parts.map((part, index) => (
                      <MessagePart key={index} part={part} />
                    ))
                  )}
                </div>
              </div>
            ))}
          {detail.hasNextPage ? (
            <Button
              variant="outline"
              size="sm"
              className="self-center"
              disabled={detail.isFetchingNextPage}
              onClick={() => void detail.fetchNextPage()}
            >
              {detail.isFetchingNextPage
                ? "Loading…"
                : `Load more (${formatCount(total - messages.length)} left)`}
            </Button>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  )
}
