import { createContext, useContext } from "react"

import type { CacheStatus, Profile, ProjectOption, RangeArgs } from "@/lib/api"

export type RangePreset = "7d" | "30d" | "90d" | "mtd" | "all" | "custom"

export interface DashboardState {
  profiles: Profile[]
  activePath: string | null
  range: RangePreset
  rangeArgs: RangeArgs
  anchor: number
  loadingProfiles: boolean
  cacheStatus: CacheStatus | null
  projectOptions: ProjectOption[]
  selectedProject: string | null
  customFrom: string | null
  customTo: string | null
  setRange: (range: RangePreset) => void
  setCustomRange: (from: string | null, to: string | null) => void
  selectPath: (path: string) => void
  selectProject: (project: string | null) => void
  addDatabase: (path: string) => Promise<void>
  removeDatabase: (path: string) => Promise<void>
  refreshProfiles: () => Promise<void>
  refreshData: () => Promise<void>
  rebuildData: () => Promise<void>
}

export const DashboardContext = createContext<DashboardState | null>(null)

export function useDashboard(): DashboardState {
  const ctx = useContext(DashboardContext)
  if (!ctx)
    throw new Error("useDashboard must be used within DashboardProvider")
  return ctx
}
