import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"

import {
  api,
  type CacheStatus,
  type Profile,
  type ProjectOption,
  type RangeArgs,
} from "@/lib/api"
import { DashboardContext, type RangePreset } from "@/state/dashboard-context"
import { loadSettings, useSettings } from "@/state/settings-context"

const STATUS_POLL_MS = 5000

const RANGE_DAYS: Record<Exclude<RangePreset, "all" | "mtd">, number> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
}

function rangeStart(range: Exclude<RangePreset, "all">, anchor: number): number {
  if (range === "mtd") {
    const start = new Date(anchor)
    start.setDate(1)
    start.setHours(0, 0, 0, 0)
    return start.getTime()
  }
  return anchor - RANGE_DAYS[range] * 86_400_000
}

function pickDefault(profiles: Profile[]): string | null {
  const preferred = profiles.find((p) => p.isDefault) ?? profiles[0]
  return preferred?.path ?? null
}

export function DashboardProvider({ children }: { children: ReactNode }) {
  const { update: updateSettings } = useSettings()
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [activePath, setActivePath] = useState<string | null>(
    () => loadSettings().activeDatabase,
  )
  const [range, setRangeState] = useState<RangePreset>(
    () => loadSettings().defaultRange,
  )
  const [anchor, setAnchor] = useState(() => Date.now())
  const [loadingProfiles, setLoadingProfiles] = useState(true)
  const [cacheStatus, setCacheStatus] = useState<CacheStatus | null>(null)
  const [projectOptions, setProjectOptions] = useState<ProjectOption[]>([])
  const [selectedProject, setSelectedProject] = useState<string | null>(null)
  const lastEpoch = useRef<number | null>(null)

  const setRange = useCallback(
    (next: RangePreset) => {
      setRangeState(next)
      setAnchor(Date.now())
      updateSettings({ defaultRange: next })
    },
    [updateSettings],
  )

  const refreshProfiles = useCallback(async () => {
    try {
      const found = await api.listProfiles()
      setProfiles(found)
      setActivePath((current) => {
        if (current && found.some((f) => f.path === current)) return current
        return pickDefault(found)
      })
    } finally {
      setLoadingProfiles(false)
    }
  }, [])

  useEffect(() => {
    void refreshProfiles()
  }, [refreshProfiles])

  useEffect(() => {
    if (loadingProfiles) return
    updateSettings({ activeDatabase: activePath })
  }, [activePath, loadingProfiles, updateSettings])

  useEffect(() => {
    let cancelled = false
    const poll = async () => {
      try {
        const status = await api.cacheStatus()
        if (cancelled) return
        setCacheStatus(status)
        if (lastEpoch.current !== null && status.ingestEpoch !== lastEpoch.current) {
          setAnchor(Date.now())
        }
        lastEpoch.current = status.ingestEpoch
      } catch {
        // backend not ready yet; retry on next tick
      }
    }
    void poll()
    const interval = setInterval(() => void poll(), STATUS_POLL_MS)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [])

  const refreshData = useCallback(async () => {
    const status = await api.refreshCache()
    setCacheStatus(status)
    lastEpoch.current = status.ingestEpoch
    setAnchor(Date.now())
  }, [])

  const selectPath = useCallback((path: string) => {
    setActivePath(path)
    setSelectedProject(null)
  }, [])

  const selectProject = useCallback((project: string | null) => {
    setSelectedProject(project)
  }, [])

  const ingestEpoch = cacheStatus?.ingestEpoch ?? 0
  useEffect(() => {
    let cancelled = false
    const paths = activePath ? [activePath] : []
    const load = paths.length
      ? api.listProjects(paths).catch(() => [])
      : Promise.resolve([])
    load.then((options) => {
      if (!cancelled) setProjectOptions(options)
    })
    return () => {
      cancelled = true
    }
  }, [activePath, ingestEpoch])

  const addDatabase = useCallback(
    async (path: string) => {
      await api.addDatabase(path)
      await refreshProfiles()
      setActivePath(path)
    },
    [refreshProfiles],
  )

  const removeDatabase = useCallback(
    async (path: string) => {
      await api.removeDatabase(path)
      setActivePath((current) => (current === path ? null : current))
      await refreshProfiles()
    },
    [refreshProfiles],
  )

  const rangeArgs = useMemo<RangeArgs>(() => {
    const args: RangeArgs = { dbPaths: activePath ? [activePath] : [] }
    if (range !== "all") {
      args.from = rangeStart(range, anchor)
    }
    if (selectedProject) {
      args.project = selectedProject
    }
    return args
  }, [activePath, range, anchor, selectedProject])

  const value = useMemo(
    () => ({
      profiles,
      activePath,
      range,
      rangeArgs,
      loadingProfiles,
      cacheStatus,
      projectOptions,
      selectedProject,
      setRange,
      selectPath,
      selectProject,
      addDatabase,
      removeDatabase,
      refreshProfiles,
      refreshData,
    }),
    [
      profiles,
      activePath,
      range,
      rangeArgs,
      loadingProfiles,
      cacheStatus,
      projectOptions,
      selectedProject,
      setRange,
      selectPath,
      selectProject,
      addDatabase,
      removeDatabase,
      refreshProfiles,
      refreshData,
    ],
  )

  return <DashboardContext.Provider value={value}>{children}</DashboardContext.Provider>
}
