import { useState } from "react"
import { open } from "@tauri-apps/plugin-dialog"
import {
  ChevronDown,
  Database,
  DatabaseBackup,
  LoaderCircle,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { useGlobalLoading } from "@/hooks/use-global-loading"
import { formatBytes, formatRelativeTime } from "@/lib/format"
import { useDashboard } from "@/state/dashboard-context"

export function ProfileMenu() {
  const {
    profiles,
    activePath,
    selectPath,
    addDatabase,
    removeDatabase,
    cacheStatus,
    refreshData,
    rebuildData,
  } = useDashboard()
  const loading = useGlobalLoading()
  const [error, setError] = useState<string | null>(null)

  const active = profiles.find((p) => p.path === activePath)
  const building = cacheStatus?.sources.find((s) => s.building)
  const busy = loading || cacheStatus?.refreshing === true
  const activeSource = cacheStatus?.sources.find((s) => s.path === activePath)
  const lastIndexed = activeSource?.timeRefreshed
    ? `Last indexed ${formatRelativeTime(activeSource.timeRefreshed)}`
    : "Not indexed yet"

  const pickDatabase = async () => {
    setError(null)
    const picked = await open({
      multiple: false,
      filters: [{ name: "SQLite database", extensions: ["db", "sqlite"] }],
    })
    if (typeof picked !== "string") return
    try {
      await addDatabase(picked)
    } catch (err) {
      setError(String(err))
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button variant="outline" size="sm">
              <Database />
              {active?.name ?? "No database"}
            </Button>
          }
        />
        <DropdownMenuContent align="end" className="w-96">
          <DropdownMenuGroup>
            <DropdownMenuLabel>Active database</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={activePath ?? undefined}
              onValueChange={(value) => {
                if (typeof value === "string") selectPath(value)
              }}
            >
              {profiles.map((profile) => (
                <DropdownMenuRadioItem
                  key={profile.path}
                  value={profile.path}
                  closeOnClick
                >
                  <div className="flex min-w-0 flex-1 items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate font-medium">
                        {profile.name}
                        {profile.isDefault ? " (auto)" : ""}
                      </div>
                      <div className="truncate text-xs text-muted-foreground">
                        {profile.sessions.toLocaleString()} sessions ·{" "}
                        {formatBytes(profile.sizeBytes)}
                      </div>
                    </div>
                    {!profile.isDefault && (
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Remove ${profile.name}`}
                        onClick={(event) => {
                          event.stopPropagation()
                          event.preventDefault()
                          void removeDatabase(profile.path)
                        }}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    )}
                  </div>
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => void pickDatabase()}>
            <Plus />
            Add database…
          </DropdownMenuItem>
          {building && (
            <div className="px-2 py-1.5 text-xs text-muted-foreground">
              Indexing {building.progressRows.toLocaleString()} rows…
            </div>
          )}
          {error && (
            <div className="px-2 py-1.5 text-xs text-destructive">{error}</div>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <div className="flex items-center">
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="outline"
                size="icon-sm"
                className="rounded-r-none"
                aria-label="Refresh data"
                disabled={busy}
                onClick={() => void refreshData()}
              >
                {busy ? (
                  <LoaderCircle className="animate-spin" />
                ) : (
                  <RefreshCw />
                )}
              </Button>
            }
          />
          <TooltipContent>Refresh data</TooltipContent>
        </Tooltip>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="outline"
                size="icon-sm"
                className="-ml-px w-5 rounded-l-none [&_svg]:size-3"
                aria-label="Indexing options"
                disabled={busy}
              >
                <ChevronDown />
              </Button>
            }
          />
          <DropdownMenuContent align="end" className="w-72">
            <DropdownMenuGroup>
              <DropdownMenuLabel>{lastIndexed}</DropdownMenuLabel>
              <DropdownMenuItem onClick={() => void refreshData()}>
                <RefreshCw />
                <div className="flex flex-col">
                  <span>Refresh now</span>
                  <span className="text-xs text-muted-foreground">
                    Index new activity only
                  </span>
                </div>
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              disabled={!activePath}
              onClick={() => void rebuildData()}
            >
              <DatabaseBackup />
              <div className="flex flex-col">
                <span>Rebuild index…</span>
                <span className="text-xs opacity-70">
                  Discard the cache and re-read{" "}
                  {active?.name ?? "this database"}
                </span>
              </div>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </>
  )
}
