import { useState } from "react"
import { open } from "@tauri-apps/plugin-dialog"
import {
  Download,
  Moon,
  Plus,
  RefreshCw,
  RotateCw,
  Sun,
  SunMoon,
  Trash2,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
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
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { useTheme } from "@/components/theme-provider"
import { useUpdater } from "@/hooks/use-updater"
import { formatBytes, formatDate } from "@/lib/format"
import { middleTruncatePath } from "@/lib/paths"
import { useDashboard } from "@/state/dashboard-context"
import { useSettings, type HeatmapMetric } from "@/state/settings-context"

const THEMES = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: SunMoon },
] as const

export function SettingsPage() {
  const { theme, setTheme } = useTheme()
  const { settings, update } = useSettings()
  const { profiles, addDatabase, removeDatabase } = useDashboard()
  const [error, setError] = useState<string | null>(null)

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
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Appearance</CardTitle>
          <CardDescription>
            Theme for the application. You can also press{" "}
            <kbd className="rounded border px-1 font-mono text-xs">d</kbd> to
            toggle dark mode.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ToggleGroup
            variant="outline"
            value={[theme]}
            onValueChange={(value: string[]) => {
              const next = value[0]
              if (next) setTheme(next as typeof theme)
            }}
          >
            {THEMES.map((item) => (
              <ToggleGroupItem key={item.value} value={item.value}>
                <item.icon className="size-3.5" />
                {item.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Preferences</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium">
              Heatmap intensity metric
            </span>
            <span className="text-xs text-muted-foreground">
              What the yearly calendar heatmap on the Overview page measures.
            </span>
            <ToggleGroup
              variant="outline"
              size="sm"
              value={[settings.heatmapMetric]}
              onValueChange={(value: string[]) => {
                const next = value[0]
                if (next) update({ heatmapMetric: next as HeatmapMetric })
              }}
            >
              <ToggleGroupItem value="cost">Cost</ToggleGroupItem>
              <ToggleGroupItem value="tokens">Tokens</ToggleGroupItem>
            </ToggleGroup>
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium">
              Check for updates on launch
            </span>
            <span className="text-xs text-muted-foreground">
              Contacts GitHub once at startup and only interrupts you when a new
              version exists.
            </span>
            <ToggleGroup
              variant="outline"
              size="sm"
              value={[settings.checkUpdatesOnStartup ? "on" : "off"]}
              onValueChange={(value: string[]) => {
                const next = value[0]
                if (next) update({ checkUpdatesOnStartup: next === "on" })
              }}
            >
              <ToggleGroupItem value="on">On</ToggleGroupItem>
              <ToggleGroupItem value="off">Off</ToggleGroupItem>
            </ToggleGroup>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Data sources</CardTitle>
          <CardDescription>
            The default OpenCode database is detected automatically. Additional
            databases can be added manually.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Path</TableHead>
                <TableHead className="text-right">Size</TableHead>
                <TableHead className="text-right">Sessions</TableHead>
                <TableHead className="text-right">Last activity</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {profiles.map((profile) => (
                <TableRow key={profile.path}>
                  <TableCell className="font-medium">
                    {profile.name}{" "}
                    {profile.isDefault && (
                      <Badge variant="secondary" className="ml-1">
                        auto
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    <Tooltip>
                      <TooltipTrigger
                        render={<span>{middleTruncatePath(profile.path)}</span>}
                      />
                      <TooltipContent>{profile.path}</TooltipContent>
                    </Tooltip>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatBytes(profile.sizeBytes)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {profile.sessions.toLocaleString()}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {profile.lastActivity
                      ? formatDate(profile.lastActivity)
                      : "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    {!profile.isDefault && (
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Remove ${profile.name}`}
                        onClick={() => void removeDatabase(profile.path)}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void pickDatabase()}
            >
              <Plus />
              Add database…
            </Button>
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
        </CardContent>
      </Card>

      <UpdatesCard />
    </div>
  )
}

function UpdatesCard() {
  const {
    phase,
    currentVersion,
    updateInfo,
    progress,
    error,
    checkForUpdates,
    downloadAndInstall,
    restart,
  } = useUpdater()
  const busy = phase === "checking" || phase === "downloading"

  return (
    <Card>
      <CardHeader>
        <CardTitle>Updates</CardTitle>
        <CardDescription>
          Chronotile only contacts GitHub when you check for updates.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm">
            <span className="font-medium">Current version</span>
            <Badge variant="secondary" className="font-mono tabular-nums">
              {currentVersion ?? "unknown"}
            </Badge>
          </div>
          <Button
            variant="outline"
            size="sm"
            disabled={busy || phase === "installed"}
            onClick={checkForUpdates}
          >
            <RefreshCw
              className={phase === "checking" ? "animate-spin" : undefined}
            />
            {phase === "checking" ? "Checking…" : "Check for updates"}
          </Button>
        </div>

        {phase === "upToDate" && (
          <p className="text-xs text-muted-foreground">
            You're running the latest version.
          </p>
        )}

        {(phase === "available" || phase === "downloading") && updateInfo && (
          <div className="flex flex-col gap-3 rounded-md border p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-sm">
                <span className="font-medium">
                  Version {updateInfo.version} is available
                </span>
              </div>
              {phase === "available" && (
                <Button size="sm" onClick={downloadAndInstall}>
                  <Download />
                  Download & install
                </Button>
              )}
            </div>
            {updateInfo.notes && (
              <pre className="max-h-40 overflow-auto text-xs whitespace-pre-wrap text-muted-foreground">
                {updateInfo.notes}
              </pre>
            )}
            {phase === "downloading" && (
              <div className="flex items-center gap-3">
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                  <div
                    className={
                      progress === null
                        ? "h-full w-1/3 animate-pulse rounded-full bg-primary"
                        : "h-full rounded-full bg-primary transition-all"
                    }
                    style={
                      progress === null
                        ? undefined
                        : { width: `${Math.round(progress * 100)}%` }
                    }
                  />
                </div>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {progress === null
                    ? "Downloading…"
                    : `${Math.round(progress * 100)}%`}
                </span>
              </div>
            )}
          </div>
        )}

        {phase === "installed" && (
          <div className="flex items-center justify-between gap-3 rounded-md border p-3">
            <span className="text-sm font-medium">
              Update installed. Restart to apply.
            </span>
            <Button size="sm" onClick={restart}>
              <RotateCw />
              Restart now
            </Button>
          </div>
        )}

        {error && <p className="text-xs text-destructive">{error}</p>}
      </CardContent>
    </Card>
  )
}
