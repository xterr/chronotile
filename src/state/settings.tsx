import { useCallback, useMemo, useState, type ReactNode } from "react"

import {
  SETTINGS_STORAGE_KEY,
  SettingsContext,
  loadSettings,
  type Settings,
} from "@/state/settings-context"

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(loadSettings)

  const update = useCallback((patch: Partial<Settings>) => {
    setSettings((current) => {
      const next = { ...current, ...patch }
      localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(next))
      return next
    })
  }, [])

  const value = useMemo(() => ({ settings, update }), [settings, update])

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>
}
