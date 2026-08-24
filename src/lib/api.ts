import { invoke as tauriInvoke } from "@tauri-apps/api/core"

const MODELS_DEV_URL = "https://models.dev/api.json"

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
  costEstimated: number
  cacheSavings: number
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
  costEstimated: number
  tokens: TokenTotals
  messages: number
  sessions: number
}

export interface GroupStat {
  key: string
  provider: string | null
  variant: string | null
  cost: number
  costEstimated: number
  tokens: TokenTotals
  messages: number
  sessions: number
  firstUsed: number
  lastUsed: number
  p50OutputTps: number | null
  variants: GroupStat[]
}

export interface ModelDailyPoint {
  date: string
  key: string
  cost: number
  costEstimated: number
  totalTokens: number
}

export interface ProjectStat {
  projectId: string
  name: string
  worktree: string
  cost: number
  costEstimated: number
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

export interface SkillStat {
  skill: string
  loads: number
  viaTask: number
  direct: number
  sessions: number
  projects: number
  firstUsed: number
  lastUsed: number
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

export interface ContextHealth {
  windowDays: number
  messages: number
  p50: number
  p95: number
  max: number
  nearLimit: number
  nearLimitFraction: number
}

export interface SessionCostStats {
  sessions: number
  p50: number
  p95: number
  max: number
}

export interface ErrorDetail {
  scope: string
  name: string
  message: string
  count: number
}

export interface FileStat {
  path: string
  reads: number
  edits: number
  writes: number
  touches: number
}

export interface RedundancyStat {
  tool: string
  calls: number
  repeatedCalls: number
  sessions: number
}

export interface SessionCursor {
  timeUpdated: number
  id: string
}

export interface SessionRow {
  id: string
  parentId: string | null
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
  childCount: number
  children: SessionRow[]
  hasMoreChildren: boolean
}

export interface SessionPage {
  rows: SessionRow[]
  nextCursor: SessionCursor | null
  total: number | null
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

export interface QuotaWindow {
  start: number
  end: number
  active: boolean
  cost: number
  costEstimated: number
  tokens: number
  messages: number
}

export interface QuotaReport {
  windowHours: number
  windows: QuotaWindow[]
  active: QuotaWindow | null
  burnTokensPerMin: number
  burnCostPerMin: number
  projectedTokens: number
  projectedCost: number
  referenceTokens: number
  warnFraction: number
  weekTokens: number
  weekCost: number
  weekCostEstimated: number
}

export interface PricingStatus {
  source: string
  generated: string
  bundled: boolean
  models: number
  ageHours: number | null
  changed: boolean
  unpricedModels: string[]
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

export interface SessionDetailPage {
  messages: MessageView[]
  total: number
  hasMore: boolean
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
  rebuildCache: (path: string) =>
    invoke<CacheStatus>("rebuild_cache", { path }),
  cacheStatus: () => tauriInvoke<CacheStatus>("get_cache_status"),
  pricingStatus: () => invoke<PricingStatus>("get_pricing_status"),
  quota: (dbPaths: string[], windowHours: number) =>
    invoke<QuotaReport>("get_quota", { dbPaths, windowHours }),
  // The fetch lives here rather than in Rust so the backend never opens a
  // socket: refreshing prices is the only moment Chronotile talks to models.dev,
  // and it only happens because the user asked.
  refreshPricing: async () => {
    const response = await fetch(MODELS_DEV_URL)
    if (!response.ok) {
      throw new Error(`models.dev responded ${response.status}`)
    }
    return invoke<PricingStatus>("refresh_pricing", { catalog: await response.text() })
  },
  overview: (args: RangeArgs) => invoke<Overview>("get_overview", { ...args }),
  dailySeries: (args: RangeArgs) =>
    invoke<DailyPoint[]>("get_daily_series", { ...args }),
  modelStats: (args: RangeArgs) =>
    invoke<GroupStat[]>("get_model_stats", { ...args }),
  agentStats: (args: RangeArgs & { normalizeAgents: boolean }) =>
    invoke<GroupStat[]>("get_agent_stats", { ...args }),
  modelDaily: (args: RangeArgs & { groupBy: "model" | "agent" }) =>
    invoke<ModelDailyPoint[]>("get_model_daily", { ...args }),
  projectStats: (args: RangeArgs) =>
    invoke<ProjectStat[]>("get_project_stats", { ...args }),
  hourlyActivity: (args: RangeArgs) =>
    invoke<HourlyCell[]>("get_hourly_activity", { ...args }),
  toolStats: (args: RangeArgs) =>
    invoke<ToolStat[]>("get_tool_stats", { ...args }),
  skillStats: (args: RangeArgs) =>
    invoke<SkillStat[]>("get_skill_stats", { ...args }),
  reliability: (args: RangeArgs) =>
    invoke<ReliabilityReport>("get_reliability", { ...args }),
  contextHealth: (dbPaths: string[]) =>
    invoke<ContextHealth>("get_context_health", { dbPaths }),
  sessionCosts: (args: RangeArgs) =>
    invoke<SessionCostStats>("get_session_costs", { ...args }),
  errorDetails: (args: RangeArgs) =>
    invoke<ErrorDetail[]>("get_error_details", { ...args }),
  fileStats: (args: RangeArgs) => invoke<FileStat[]>("get_file_stats", { ...args }),
  redundancy: (args: RangeArgs) =>
    invoke<RedundancyStat[]>("get_redundancy", { ...args }),
  sessionRoots: (
    args: RangeArgs & {
      cursor?: SessionCursor
      limit: number
      inlineChildren: number
    }
  ) => invoke<SessionPage>("get_session_roots", { ...args }),
  sessionChildren: (args: {
    dbPaths: string[]
    parentId: string
    cursor?: SessionCursor
    limit: number
  }) => invoke<SessionPage>("get_session_children", { ...args }),
  searchSessions: (
    args: RangeArgs & { query: string; cursor?: SessionCursor; limit: number }
  ) => invoke<SessionPage>("search_sessions", { ...args }),
  sessionDetail: (
    dbPath: string,
    sessionId: string,
    offset: number,
    limit: number
  ) =>
    invoke<SessionDetailPage>("get_session_detail", {
      dbPath,
      sessionId,
      offset,
      limit,
    }),
}
