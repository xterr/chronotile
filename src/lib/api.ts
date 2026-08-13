import { invoke as tauriInvoke } from "@tauri-apps/api/core"

let activeRequests = 0
const loadingListeners = new Set<() => void>()

function notifyLoading() {
  for (const listener of loadingListeners) listener()
}

export function subscribeLoading(listener: () => void): () => void {
  loadingListeners.add(listener)
  return () => loadingListeners.delete(listener)
}

export function isLoading(): boolean {
  return activeRequests > 0
}

function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  activeRequests++
  notifyLoading()
  return tauriInvoke<T>(cmd, args).finally(() => {
    activeRequests--
    notifyLoading()
  })
}

export interface Profile {
  id: string
  name: string
  path: string
  isDefault: boolean
  sizeBytes: number
  sessions: number
  firstActivity: number | null
  lastActivity: number | null
}

export interface TokenTotals {
  input: number
  output: number
  reasoning: number
  cacheRead: number
  cacheWrite: number
}

export interface Overview {
  cost: number
  tokens: TokenTotals
  messages: number
  prompts: number
  sessions: number
  activeDays: number
  modelsUsed: number
  toolCalls: number
}

export interface DailyPoint {
  date: string
  cost: number
  tokens: TokenTotals
  messages: number
  sessions: number
}

export interface GroupStat {
  key: string
  cost: number
  tokens: TokenTotals
  messages: number
  sessions: number
  firstUsed: number
  lastUsed: number
  p50OutputTps: number | null
}

export interface ModelDailyPoint {
  date: string
  key: string
  cost: number
  totalTokens: number
}

export interface ProjectStat {
  projectId: string
  name: string
  worktree: string
  cost: number
  tokens: TokenTotals
  messages: number
  sessions: number
}

export interface HourlyCell {
  weekday: number
  hour: number
  count: number
}

export interface ToolStat {
  tool: string
  calls: number
  completed: number
  errors: number
  p50DurationMs: number | null
  p95DurationMs: number | null
  totalDurationMs: number
}

export interface ErrorStat {
  name: string
  count: number
}

export interface ReliabilityReport {
  errors: ErrorStat[]
  compactionsAuto: number
  compactionsManual: number
  compactionsOverflow: number
  retries: number
}

export interface SessionRow {
  id: string
  profile: string
  title: string
  projectName: string
  directory: string
  agent: string | null
  model: string | null
  cost: number
  totalTokens: number
  tokensReasoning: number
  tokensCacheRead: number
  summaryFiles: number | null
  summaryAdditions: number | null
  summaryDeletions: number | null
  isSubagent: boolean
  timeCreated: number
  timeUpdated: number
}

export interface RangeArgs {
  dbPaths: string[]
  from?: number
  to?: number
  project?: string
}

export interface ProjectOption {
  projectId: string
  name: string
  worktree: string
}

export interface SourceStatus {
  path: string
  building: boolean
  progressRows: number
  timeRefreshed: number | null
}

export interface CacheStatus {
  refreshing: boolean
  ingestEpoch: number
  sources: SourceStatus[]
}

export interface PartView {
  kind: string
  text: string | null
  truncated: boolean
  tool: string | null
  title: string | null
  status: string | null
  durationMs: number | null
  files: number | null
}

export interface MessageView {
  id: string
  role: string
  agent: string | null
  model: string | null
  cost: number
  totalTokens: number
  error: string | null
  timeCreated: number
  parts: PartView[]
}

export const api = {
  listProfiles: () => invoke<Profile[]>("list_profiles"),
  listProjects: (dbPaths: string[]) =>
    invoke<ProjectOption[]>("list_projects", { dbPaths }),
  addDatabase: (path: string) => invoke<Profile>("add_database", { path }),
  removeDatabase: (path: string) => invoke<void>("remove_database", { path }),
  refreshCache: () => invoke<CacheStatus>("refresh_cache"),
  cacheStatus: () => tauriInvoke<CacheStatus>("get_cache_status"),
  overview: (args: RangeArgs) => invoke<Overview>("get_overview", { ...args }),
  dailySeries: (args: RangeArgs) => invoke<DailyPoint[]>("get_daily_series", { ...args }),
  modelStats: (args: RangeArgs) => invoke<GroupStat[]>("get_model_stats", { ...args }),
  agentStats: (args: RangeArgs) => invoke<GroupStat[]>("get_agent_stats", { ...args }),
  modelDaily: (args: RangeArgs & { groupBy: "model" | "agent" }) =>
    invoke<ModelDailyPoint[]>("get_model_daily", { ...args }),
  projectStats: (args: RangeArgs) => invoke<ProjectStat[]>("get_project_stats", { ...args }),
  hourlyActivity: (args: RangeArgs) => invoke<HourlyCell[]>("get_hourly_activity", { ...args }),
  toolStats: (args: RangeArgs) => invoke<ToolStat[]>("get_tool_stats", { ...args }),
  reliability: (args: RangeArgs) => invoke<ReliabilityReport>("get_reliability", { ...args }),
  sessions: (args: RangeArgs & { includeSubagents: boolean; limit: number }) =>
    invoke<SessionRow[]>("get_sessions", { ...args }),
  sessionDetail: (dbPath: string, sessionId: string) =>
    invoke<MessageView[]>("get_session_detail", { dbPath, sessionId }),
}
