import { useCallback, useEffect, useRef, useState } from "react"
import { listen } from "@tauri-apps/api/event"
import { CheckCircle2, Download, RotateCw } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { useUpdater } from "@/hooks/use-updater"
import { useSettings } from "@/state/settings-context"

export const CHECK_FOR_UPDATES_EVENT = "chronotile://check-for-updates"

const STARTUP_DELAY_MS = 2000

export function UpdatePrompt() {
  const { settings } = useSettings()
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
  const [manual, setManual] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const started = useRef(false)

  const runCheck = useCallback(
    (isManual: boolean) => {
      setManual(isManual)
      setDismissed(false)
      checkForUpdates()
    },
    [checkForUpdates]
  )

  useEffect(() => {
    const unlisten = listen(CHECK_FOR_UPDATES_EVENT, () => runCheck(true))
    return () => {
      void unlisten.then((off) => off())
    }
  }, [runCheck])

  // The guard is set when the check actually fires, not when it is scheduled:
  // StrictMode remounts cancel the pending timer, so claiming it up front
  // would swallow the only run.
  useEffect(() => {
    if (started.current || !settings.checkUpdatesOnStartup) return
    const timer = setTimeout(() => {
      started.current = true
      runCheck(false)
    }, STARTUP_DELAY_MS)
    return () => clearTimeout(timer)
  }, [settings.checkUpdatesOnStartup, runCheck])

  // A silent startup check stays invisible unless it finds something; only a
  // check the user asked for reports "up to date" or a network failure.
  const hasUpdate =
    phase === "available" || phase === "downloading" || phase === "installed"
  const open =
    !dismissed &&
    (hasUpdate || (manual && (phase === "upToDate" || error !== null)))

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setDismissed(true)
      }}
    >
      <DialogContent>
        {hasUpdate && updateInfo ? (
          <>
            <DialogHeader>
              <DialogTitle>
                Version {updateInfo.version} is available
              </DialogTitle>
              <DialogDescription>
                You're on{" "}
                <Badge variant="secondary" className="font-mono tabular-nums">
                  {currentVersion ?? "unknown"}
                </Badge>
              </DialogDescription>
            </DialogHeader>

            {updateInfo.notes && (
              <pre className="max-h-56 overflow-auto rounded-md bg-muted/50 p-3 text-xs whitespace-pre-wrap text-muted-foreground">
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

            {error && <p className="text-xs text-destructive">{error}</p>}

            <DialogFooter>
              {phase === "installed" ? (
                <>
                  <span className="mr-auto text-sm">Update installed.</span>
                  <Button size="sm" onClick={restart}>
                    <RotateCw />
                    Restart now
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setDismissed(true)}
                  >
                    Later
                  </Button>
                  <Button
                    size="sm"
                    disabled={phase === "downloading"}
                    onClick={downloadAndInstall}
                  >
                    <Download />
                    {phase === "downloading" ? "Installing…" : "Install update"}
                  </Button>
                </>
              )}
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                {error ? (
                  "Could not check for updates"
                ) : (
                  <>
                    <CheckCircle2 className="size-4 text-primary" />
                    You're up to date
                  </>
                )}
              </DialogTitle>
              <DialogDescription>
                {error ??
                  `Chronotile ${currentVersion ?? ""} is the latest version.`}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button size="sm" onClick={() => setDismissed(true)}>
                Done
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
