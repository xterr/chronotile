<div align="center">

<img src="design/logos/08-heatmap.svg" alt="chronotile" width="96" height="96">

# Chronotile

**Local usage analytics for [opencode](https://opencode.ai) — cost, tokens, models, tools, and sessions, tiled by day.**

<img alt="tauri 2" src="https://img.shields.io/badge/tauri-2.x-24C8D8?logo=tauri&logoColor=white">
<img alt="react 19" src="https://img.shields.io/badge/react-19-087EA4?logo=react&logoColor=white">
<img alt="rust backend" src="https://img.shields.io/badge/backend-rust-B7410E?logo=rust&logoColor=white">
<img alt="shadcn/ui" src="https://img.shields.io/badge/ui-shadcn%2Fui-101014">
<img alt="license MIT" src="https://img.shields.io/badge/license-MIT-blue">

<img src="design/screenshot.png" alt="chronotile overview" width="800">

</div>

---

## Why Chronotile?

opencode records every session, message, token, and tool call in a local SQLite database — and then
never shows you any of it. How much did this month cost? Which model burns the budget? Which project
eats the tokens? What does your agent actually *do* all day? The data is sitting on your disk;
Chronotile turns it into a dashboard.

- 📊 **Every stat that matters** — spend, tokens (including reasoning and cache), models, agents,
  tools, projects, sessions, errors — all filterable by project and time range.
- ⚡ **Instant on multi-gigabyte databases** — an incremental rollup cache answers every query in
  milliseconds, no matter how large your history grows.
- 🔒 **Local and read-only** — your opencode databases are opened read-only, nothing is modified,
  and nothing ever leaves your machine.

Chronotile is a native desktop app (Tauri 2, Rust backend, React + shadcn/ui frontend). It
auto-detects your default opencode database and lets you register any number of additional ones —
for example per-profile databases created by [ocp](https://github.com/xterr/ocp).

## Features

- **Overview** — total cost, token breakdown, cache-hit rate, and a GitHub-style 12-month
  calendar heatmap of daily spend or token intensity.
- **Per-model & per-provider stats** — cost share, daily stacked trends, message/session counts,
  and median output tokens-per-second measured from your own traffic.
- **Agent & tool analytics** — which agents spend the money; per-tool call counts, error rates,
  and p50/p95 durations.
- **Projects** — spend and activity per repository, including sessions from non-git directories.
- **Session browser with transcripts** — drill into any session and read the conversation:
  messages, tool calls with durations, reasoning, file patches, and errors.
- **Reliability** — error breakdown by type, aborted-message rate, compactions, and retries.
- **Project filter & time ranges** — a searchable project picker and 7d / 30d / 90d / MTD / All
  ranges, persisted across restarts.
- **Multiple databases** — the default opencode database is detected automatically; add or remove
  others manually and switch with one click.
- **Native polish** — light/dark/system theme with a matching macOS title bar, collapsible icon
  sidebar, and a fixed, no-overscroll shell.

## Install

There are no packaged releases yet — build from source:

```sh
git clone git@github.com:xterr/chronotile.git
cd chronotile
yarn install
yarn tauri build
```

The bundled app lands in `src-tauri/target/release/bundle/` (`.app`/`.dmg` on macOS).

**Prerequisites:** [Rust](https://rustup.rs) (stable), Node.js ≥ 20 with
[corepack](https://nodejs.org/api/corepack.html) enabled (Chronotile uses Yarn 4), and the
[Tauri platform dependencies](https://v2.tauri.app/start/prerequisites/) for your OS.

## Quick start

1. Launch Chronotile — your default opencode database
   (`~/.local/share/opencode/opencode.db`) is detected automatically and indexed in the
   background (a few seconds per gigabyte, one time only).
2. Add more databases via **Settings → Data sources** or the database menu in the top bar —
   useful for [ocp](https://github.com/xterr/ocp) profile databases.
3. Pick a project and a time range in the top bar; every page follows.
4. Data refreshes automatically every minute; use **Refresh data** in the database menu to
   force it.

## How it works

Chronotile never queries your opencode database directly from the UI. A Rust ingest engine mirrors
it into a compact local rollup cache, and the dashboard reads only from that:

| What | Where | Notes |
| --- | --- | --- |
| opencode databases | wherever they live | opened **read-only**, WAL-safe alongside a running opencode |
| rollup cache | `~/Library/Application Support/design.xterr.chronotile/cache.db` | day-grain star-schema facts; ~15 MB for 10 GB of sources |
| registered sources | `.../design.xterr.chronotile/sources.json` | the manually added database paths |
| refresh | every 60 s + manual trigger | incremental: only new rows are read |

The ingest is incremental by design: opencode's message and part IDs encode time, so each cycle is
an indexed range scan past a stored watermark — never a full rescan. In-flight messages are held in
a pending set until their cost and tokens are final; a per-cycle sentinel detects deletions
(session removals, reverts) and rebuilds the affected source automatically. The cache schema is
versioned with forward-only migrations that run on startup, so upgrades are automatic — including
migrations that require re-ingesting the sources.

## Pages

| Page | What it shows |
| --- | --- |
| **Overview** | Stat cards, daily cost, daily token mix, 12-month heatmap |
| **Activity** | Messages & sessions per day, working-hours punch card |
| **Models** | Cost share donut, stacked daily cost, per-model table with p50 tok/s |
| **Agents** | The same breakdown, keyed by agent |
| **Tools** | Call counts, error rates, p50/p95 durations per tool |
| **Projects** | Spend per repository, with per-directory attribution for non-git work |
| **Sessions** | Filterable session list with full transcript drill-down |
| **Reliability** | Errors by type, compactions, retries |
| **Settings** | Theme, heatmap metric, data-source management |

## Data & privacy

Everything is local. Chronotile reads your opencode databases read-only and writes only to its own
application directory:

```
~/Library/Application Support/design.xterr.chronotile/   # macOS
├── sources.json    # registered database paths
└── cache.db        # derived rollup cache (safe to delete; rebuilds)
```

No telemetry, no network calls, no accounts.

## Development

```sh
yarn install
yarn tauri dev       # runs vite + the tauri shell with hot reload
```

Quality gates:

```sh
yarn typecheck                                     # tsc
yarn lint                                          # eslint
yarn build                                         # vite production build
cargo check --manifest-path src-tauri/Cargo.toml   # rust
```

The frontend lives in `src/` (React 19, Tailwind 4, shadcn/ui, Recharts); the backend in
`src-tauri/src/` — `cache/` holds the ingest engine, migrations, and read layer. Logo proposals
and brand assets live in `design/`.

## Uninstall

```sh
rm -rf /Applications/Chronotile.app                                    # the app
rm -rf ~/Library/Application\ Support/design.xterr.chronotile          # cache + sources
```

Your opencode databases are never touched.

## License

[MIT](LICENSE) © xterr
