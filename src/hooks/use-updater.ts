import { useCallback, useEffect, useRef, useState } from "react"
import { getVersion } from "@tauri-apps/api/app"
import { relaunch } from "@tauri-apps/plugin-process"
import { check, type Update } from "@tauri-apps/plugin-updater"

export type UpdaterPhase =
  "idle" | "checking" | "upToDate" | "available" | "downloading" | "installed"

export interface UpdateInfo {
  version: string
  notes: string | null
}

interface UpdaterState {
  phase: UpdaterPhase
  currentVersion: string | null
  updateInfo: UpdateInfo | null
  /** Download progress in [0, 1], or null while the total size is unknown. */
  progress: number | null
  error: string | null
  checkForUpdates: () => void
  downloadAndInstall: () => void
  restart: () => void
}

export function useUpdater(): UpdaterState {
  const [phase, setPhase] = useState<UpdaterPhase>("idle")
  const [currentVersion, setCurrentVersion] = useState<string | null>(null)
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null)
  const [progress, setProgress] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const updateRef = useRef<Update | null>(null)

  useEffect(() => {
    getVersion()
      .then(setCurrentVersion)
      .catch(() => setCurrentVersion(null))
  }, [])

  const checkForUpdates = useCallback(() => {
    setPhase("checking")
    setError(null)
    setUpdateInfo(null)
    void updateRef.current?.close().catch(() => undefined)
    updateRef.current = null
    check()
      .then((update) => {
        if (update) {
          updateRef.current = update
          setUpdateInfo({ version: update.version, notes: update.body ?? null })
          setPhase("available")
        } else {
          setPhase("upToDate")
        }
      })
      .catch((err: unknown) => {
        setError(String(err))
        setPhase("idle")
      })
  }, [])

  const downloadAndInstall = useCallback(() => {
    const update = updateRef.current
    if (!update) return
    setPhase("downloading")
    setError(null)
    setProgress(null)
    let total = 0
    let downloaded = 0
    update
      .downloadAndInstall((event) => {
        switch (event.event) {
          case "Started":
            total = event.data.contentLength ?? 0
            break
          case "Progress":
            downloaded += event.data.chunkLength
            if (total > 0) setProgress(Math.min(downloaded / total, 1))
            break
          case "Finished":
            setProgress(1)
            break
        }
      })
      .then(() => {
        // On Windows the installer exits the app before we get here.
        setPhase("installed")
      })
      .catch((err: unknown) => {
        setError(String(err))
        setPhase("available")
      })
  }, [])

  const restart = useCallback(() => {
    relaunch().catch((err: unknown) => setError(String(err)))
  }, [])

  return {
    phase,
    currentVersion,
    updateInfo,
    progress,
    error,
    checkForUpdates,
    downloadAndInstall,
    restart,
  }
}
