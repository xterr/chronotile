import { useSyncExternalStore } from "react"

import { isLoading, subscribeLoading } from "@/lib/api"

export function useGlobalLoading(): boolean {
  return useSyncExternalStore(subscribeLoading, isLoading)
}
