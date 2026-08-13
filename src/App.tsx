import { useState } from "react"

import { AppSidebar, type Page } from "@/components/app-sidebar"
import { ProfileMenu } from "@/components/profile-menu"
import { ProjectPicker } from "@/components/project-picker"
import { RangePicker } from "@/components/range-picker"
import { Separator } from "@/components/ui/separator"
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar"
import { TooltipProvider } from "@/components/ui/tooltip"
import { ActivityPage } from "@/pages/activity"
import { AgentsPage } from "@/pages/agents"
import { ModelsPage } from "@/pages/models"
import { OverviewPage } from "@/pages/overview"
import { ProjectsPage } from "@/pages/projects"
import { ReliabilityPage } from "@/pages/reliability"
import { SessionsPage } from "@/pages/sessions"
import { SettingsPage } from "@/pages/settings"
import { ToolsPage } from "@/pages/tools"
import { useDashboard } from "@/state/dashboard-context"
import { DashboardProvider } from "@/state/dashboard"
import { SettingsProvider } from "@/state/settings"

const PAGES: Record<Page, { title: string; component: () => React.ReactNode }> = {
  overview: { title: "Overview", component: OverviewPage },
  activity: { title: "Activity", component: ActivityPage },
  models: { title: "Models", component: ModelsPage },
  agents: { title: "Agents", component: AgentsPage },
  tools: { title: "Tools", component: ToolsPage },
  projects: { title: "Projects", component: ProjectsPage },
  sessions: { title: "Sessions", component: SessionsPage },
  reliability: { title: "Reliability", component: ReliabilityPage },
  settings: { title: "Settings", component: SettingsPage },
}

function Shell() {
  const [page, setPage] = useState<Page>("overview")
  const { profiles, loadingProfiles, activePath } = useDashboard()
  const Current = PAGES[page].component

  return (
    <SidebarProvider>
      <AppSidebar page={page} onNavigate={setPage} />
      <SidebarInset className="h-svh overflow-hidden">
        <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
          <SidebarTrigger />
          <Separator orientation="vertical" className="mr-1" />
          <h1 className="text-sm font-semibold">{PAGES[page].title}</h1>
          <div className="ml-auto flex items-center gap-2">
            <ProjectPicker />
            <RangePicker />
            <ProfileMenu />
          </div>
        </header>
        <main className="min-h-0 flex-1 overflow-auto p-4">
          {page === "settings" ? (
            <Current />
          ) : !loadingProfiles && profiles.length === 0 ? (
            <EmptyState message="No OpenCode database found. Add one in Settings." />
          ) : !loadingProfiles && activePath === null ? (
            <EmptyState message="No database selected. Pick one in the databases menu." />
          ) : (
            <Current />
          )}
        </main>
      </SidebarInset>
    </SidebarProvider>
  )
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex h-full items-center justify-center">
      <p className="max-w-sm text-center text-sm text-muted-foreground">{message}</p>
    </div>
  )
}

export function App() {
  return (
    <SettingsProvider>
      <DashboardProvider>
        <TooltipProvider delay={100} closeDelay={0}>
          <Shell />
        </TooltipProvider>
      </DashboardProvider>
    </SettingsProvider>
  )
}

export default App
