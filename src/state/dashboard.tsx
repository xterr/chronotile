import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"

import {
  api,
  type Profile,
  type ProjectOption,
  type RangeArgs,
} from "@/lib/api"
import { DashboardContext, type RangePreset } from "@/state/dashboard-context"
import { loadSettings, useSettings } from "@/state/settings-context"

const STATUS_POLL_MS = 5000
const STATUS_KEY = "cacheStatus"
const PROFILES_KEY = "profiles"
const SHELL_KEYS = new Set<string>([STATUS_KEY, PROFILES_KEY])
const EMPTY_PROFILES: Profile[] = []
const EMPTY_PROJECTS: ProjectOption[] = []

const RANGE_DAYS: Record<Exclude<RangePreset, "all" | "mtd" | "custom">, number> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
}

/** Parses a yyyy-mm-dd input as local midnight, matching the day-grain facts. */
function parseDay(value: string, endOfDay = false): number | null {
  const [year, month, day] = value.split("-").map(Number)
  if (!year || !month || !day) return null
  const at = new Date(year, month - 1, day)
  if (endOfDay) at.setHours(23, 59, 59, 999)
  return at.getTime()
}

function rangeStart(
  range: Exclude<RangePreset, "all" | "custom">,
  anchor: number
): number {
  if (range === "mtd") {
    const start = new Date(anchor)
    start.setDate(1)
    start.setHours(0, 0, 0, 0)
    return start.getTime()
  }
  return anchor - RANGE_DAYS[range] * 86_400_000
}

/* Facts are day-grain, so the anchor is too. A stable anchor keeps query keys
   identical while the range is toggled back and forth; freshness comes from
   explicit invalidation on a new ingest, not from a moving key. */
function dayStart(now: number): number {
  const day = new Date(now)
  day.setHours(0, 0, 0, 0)
  return day.getTime()
}

function pickDefault(profiles: Profile[]): string | null {
  const preferred = profiles.find((p) => p.isDefault) ?? profiles[0]
  return preferred?.path ?? null
}

export function DashboardProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const { update: updateSettings } = useSettings()
  const [activePath, setActivePath] = useState<string | null>(
    () => loadSettings().activeDatabase
  )
  const [range, setRangeState] = useState<RangePreset>(
    () => loadSettings().defaultRange
  )
  const [anchor, setAnchor] = useState(() => dayStart(Date.now()))
  const [customFrom, setCustomFrom] = useState<string | null>(
    () => loadSettings().customFrom
  )
  const [customTo, setCustomTo] = useState<string | null>(
    () => loadSettings().customTo
  )
  const [selectedProject, setSelectedProject] = useState<string | null>(null)
  const lastEpoch = useRef<number | null>(null)

  const profilesQuery = useQuery({
    queryKey: [PROFILES_KEY],
    queryFn: () => api.listProfiles(),
  })
  const profiles = useMemo(
    () => profilesQuery.data ?? EMPTY_PROFILES,
    [profilesQuery.data]
  )
  const loadingProfiles = profilesQuery.isPending

  const { data: cacheStatus = null } = useQuery({
    queryKey: [STATUS_KEY],
    queryFn: () => api.cacheStatus(),
    refetchInterval: STATUS_POLL_MS,
    staleTime: 0,
  })

  const { data: projectOptions = EMPTY_PROJECTS } = useQuery({
    queryKey: ["projects", activePath],
    queryFn: () => api.listProjects(activePath ? [activePath] : []),
    enabled: activePath !== null,
  })

  /* An ingest only changes rollup data. The status poll must not invalidate
     itself, and the database registry only changes when the user edits it. */
  const invalidateData = useCallback(
    () =>
      queryClient.invalidateQueries({
        predicate: (query) => !SHELL_KEYS.has(String(query.queryKey[0])),
      }),
    [queryClient]
  )

  const setRange = useCallback(
    (next: RangePreset) => {
      setRangeState(next)
      setAnchor(dayStart(Date.now()))
      updateSettings({ defaultRange: next })
    },
    [updateSettings]
  )

  const setCustomRange = useCallback(
    (from: string | null, to: string | null) => {
      setCustomFrom(from)
      setCustomTo(to)
      updateSettings({ customFrom: from, customTo: to })
    },
    [updateSettings]
  )

  const refreshProfiles = useCallback(async () => {
    await profilesQuery.refetch()
  }, [profilesQuery])

  const [pickedFor, setPickedFor] = useState<Profile[] | null>(null)
  if (profilesQuery.isSuccess && pickedFor !== profiles) {
    setPickedFor(profiles)
    setActivePath((current) =>
      current && profiles.some((f) => f.path === current)
        ? current
        : pickDefault(profiles)
    )
  }

  useEffect(() => {
    if (loadingProfiles) return
    updateSettings({ activeDatabase: activePath })
  }, [activePath, loadingProfiles, updateSettings])

  const ingestEpoch = cacheStatus?.ingestEpoch ?? null
  useEffect(() => {
    if (ingestEpoch === null) return
    if (lastEpoch.current !== null && ingestEpoch !== lastEpoch.current) {
      void invalidateData()
    }
    lastEpoch.current = ingestEpoch
  }, [ingestEpoch, invalidateData])

  const refreshData = useCallback(async () => {
    const status = await api.refreshCache()
    lastEpoch.current = status.ingestEpoch
    queryClient.setQueryData([STATUS_KEY], status)
    await invalidateData()
  }, [queryClient, invalidateData])

  const rebuildData = useCallback(async () => {
    if (!activePath) return
    const status = await api.rebuildCache(activePath)
    lastEpoch.current = status.ingestEpoch
    queryClient.setQueryData([STATUS_KEY], status)
    await invalidateData()
  }, [activePath, queryClient, invalidateData])

  const selectPath = useCallback((path: string) => {
    setActivePath(path)
    setSelectedProject(null)
  }, [])

  const selectProject = useCallback((project: string | null) => {
    setSelectedProject(project)
  }, [])

  const addDatabase = useCallback(
    async (path: string) => {
      await api.addDatabase(path)
      await refreshProfiles()
      setActivePath(path)
    },
    [refreshProfiles]
  )

  const removeDatabase = useCallback(
    async (path: string) => {
      await api.removeDatabase(path)
      setActivePath((current) => (current === path ? null : current))
      await refreshProfiles()
    },
    [refreshProfiles]
  )

  const rangeArgs = useMemo<RangeArgs>(() => {
    const args: RangeArgs = { dbPaths: activePath ? [activePath] : [] }
    if (range === "custom") {
      const from = customFrom ? parseDay(customFrom) : null
      const to = customTo ? parseDay(customTo, true) : null
      if (from !== null) args.from = from
      if (to !== null) args.to = to
    } else if (range !== "all") {
      args.from = rangeStart(range, anchor)
    }
    if (selectedProject) {
      args.project = selectedProject
    }
    return args
  }, [activePath, range, anchor, selectedProject, customFrom, customTo])

  const value = useMemo(
    () => ({
      profiles,
      activePath,
      range,
      rangeArgs,
      anchor,
      loadingProfiles,
      cacheStatus,
      projectOptions,
      selectedProject,
      customFrom,
      customTo,
      setRange,
      setCustomRange,
      selectPath,
      selectProject,
      addDatabase,
      removeDatabase,
      refreshProfiles,
      refreshData,
      rebuildData,
    }),
    [
      profiles,
      activePath,
      range,
      rangeArgs,
      anchor,
      loadingProfiles,
      cacheStatus,
      projectOptions,
      selectedProject,
      customFrom,
      customTo,
      setRange,
      setCustomRange,
      selectPath,
      selectProject,
      addDatabase,
      removeDatabase,
      refreshProfiles,
      refreshData,
      rebuildData,
    ]
  )

  return (
    <DashboardContext.Provider value={value}>
      {children}
    </DashboardContext.Provider>
  )
}
