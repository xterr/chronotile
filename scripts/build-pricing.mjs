#!/usr/bin/env node
// Regenerates the bundled pricing snapshot from models.dev.
//
// models.dev's api.json is ~4 MB of capability metadata; Chronotile only needs
// the four token rates and the context limit per model. Trimming to those, and
// storing them as positional rows rather than repeating the key names ~7000
// times, gets the snapshot small enough to compile into the binary with
// include_str! so the app has working prices with no network access on
// first run.
//
//   node scripts/build-pricing.mjs              # fetch live
//   node scripts/build-pricing.mjs path/to.json # trim a local copy
//
// Rates are USD per million tokens, exactly as models.dev publishes them.

import { writeFileSync, readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"

const SOURCE = "https://models.dev/api.json"
const OUT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../src-tauri/resources/pricing.json"
)

async function load(local) {
  if (local) return JSON.parse(readFileSync(local, "utf8"))
  const response = await fetch(SOURCE)
  if (!response.ok) throw new Error(`${SOURCE} responded ${response.status}`)
  return response.json()
}

// Column order must stay in sync with pricing.rs::FIELDS.
const FIELDS = ["provider", "model", "input", "output", "cacheRead", "cacheWrite", "context"]

function trim(catalog) {
  const models = []
  for (const [providerId, provider] of Object.entries(catalog)) {
    for (const [modelId, model] of Object.entries(provider.models ?? {})) {
      const cost = model.cost
      if (!cost || typeof cost.input !== "number") continue
      models.push([
        providerId,
        modelId,
        cost.input,
        cost.output ?? 0,
        cost.cache_read ?? 0,
        cost.cache_write ?? 0,
        model.limit?.context ?? 0,
      ])
    }
  }
  models.sort((a, b) => (a[0] === b[0] ? a[1].localeCompare(b[1]) : a[0].localeCompare(b[0])))
  return models
}

const models = trim(await load(process.argv[2]))
if (models.length === 0) throw new Error("no priced models found — refusing to write an empty catalog")

const rows = models.map((model) => JSON.stringify(model)).join(",\n")
writeFileSync(
  OUT,
  `{"source":${JSON.stringify(SOURCE)},"generated":${JSON.stringify(
    new Date().toISOString()
  )},"fields":${JSON.stringify(FIELDS)},"models":[\n${rows}\n]}\n`
)
console.log(`wrote ${models.length} models to ${OUT}`)
