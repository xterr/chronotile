import { createContext, useContext } from "react"

import type { RangePreset } from "@/state/dashboard-context"

export type HeatmapMetric = "cost" | "tokens"

/**
 * `reported` is what opencode billed, which is $0 for every subscription and
 * OAuth-plan message. `estimated` prices the token counts, which are always
 * recorded, so it is the default: it is the only mode that reflects all usage.
 */
export type CostMode = "reported" | "estimated" | "both"

export interface Settings {
  defaultRange: RangePreset
  heatmapMetric: HeatmapMetric
  costMode: CostMode
  normalizeAgents: boolean
  quotaWindowHours: number
  customFrom: string | null
  customTo: string | null
  activeDatabase: string | null
  checkUpdatesOnStartup: boolean
  refreshPricingOnStartup: boolean
}

export const DEFAULT_SETTINGS: Settings = {
  defaultRange: "30d",
  heatmapMetric: "cost",
  costMode: "estimated",
  normalizeAgents: true,
  quotaWindowHours: 5,
  customFrom: null,
  customTo: null,
  activeDatabase: null,
  checkUpdatesOnStartup: true,
  refreshPricingOnStartup: true,
}

export interface SettingsState {
  settings: Settings
  update: (patch: Partial<Settings>) => void
}

export const SettingsContext = createContext<SettingsState | null>(null)

export function useSettings(): SettingsState {
  const ctx = useContext(SettingsContext)
  if (!ctx) throw new Error("useSettings must be used within SettingsProvider")
  return ctx
}

export const SETTINGS_STORAGE_KEY = "chronotile-settings"

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY)
    if (!raw) return DEFAULT_SETTINGS
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<Settings>) }
  } catch {
    return DEFAULT_SETTINGS
  }
}
