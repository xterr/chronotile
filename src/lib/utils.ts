import { clsx, type ClassValue } from "clsx"
import { extendTailwindMerge } from "tailwind-merge"

/* Custom theme values must be registered or tailwind-merge leaves conflicting
   utilities in place and the winner is decided by stylesheet order. */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      tracking: [{ tracking: ["display", "figure", "title", "micro"] }],
      ease: [{ ease: ["drawer"] }],
    },
  },
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
