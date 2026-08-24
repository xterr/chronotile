import { createContext, useContext } from "react"

import type { RangePreset } from "@/state/dashboard-context"

export type HeatmapMetric = "cost" | "tokens"

export interface Settings {
  defaultRange: RangePreset
  heatmapMetric: HeatmapMetric
  activeDatabase: string | null
  checkUpdatesOnStartup: boolean
}

export const DEFAULT_SETTINGS: Settings = {
  defaultRange: "30d",
  heatmapMetric: "cost",
  activeDatabase: null,
  checkUpdatesOnStartup: true,
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
