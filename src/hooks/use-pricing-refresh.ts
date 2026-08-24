import { useEffect, useRef } from "react"
import { useQueryClient } from "@tanstack/react-query"

import { api } from "@/lib/api"
import { useSettings } from "@/state/settings-context"

/**
 * Refetch the catalog at most once a day. Rates move rarely, and the app is
 * already correct without this: startup loads the copy on disk, so the fetch is
 * a background top-up rather than something the first paint waits on.
 */
const MAX_AGE_HOURS = 24

export function usePricingRefresh(enabled: boolean) {
  const queryClient = useQueryClient()
  const { settings } = useSettings()
  const ran = useRef(false)

  const allowed = enabled && settings.refreshPricingOnStartup

  useEffect(() => {
    if (!allowed || ran.current) return
    ran.current = true

    void (async () => {
      try {
        const status = await api.pricingStatus()
        const stale =
          status.bundled ||
          status.ageHours === null ||
          status.ageHours >= MAX_AGE_HOURS
        if (!stale) return

        const refreshed = await api.refreshPricing()
        // Rates are unchanged on almost every check. Invalidating regardless
        // would make the whole dashboard refetch on each launch for nothing.
        if (refreshed.changed) {
          await queryClient.invalidateQueries()
        } else {
          await queryClient.invalidateQueries({ queryKey: ["pricingStatus"] })
        }
      } catch {
        // An offline launch is not a failure: the bundled or previously saved
        // catalog is already loaded and every price still resolves.
      }
    })()
  }, [allowed, queryClient])
}
