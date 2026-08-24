import { useState } from "react"

import { AppSidebar, type Page } from "@/components/app-sidebar"
import { ProfileMenu } from "@/components/profile-menu"
import { ProjectPicker } from "@/components/project-picker"
import { RangePicker } from "@/components/range-picker"
import { UpdatePrompt } from "@/components/update-prompt"
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar"
import { TooltipProvider } from "@/components/ui/tooltip"
import { ActivityPage } from "@/pages/activity"
import { AgentsPage } from "@/pages/agents"
import { ModelsPage } from "@/pages/models"
import { OverviewPage } from "@/pages/overview"
import { ProjectsPage } from "@/pages/projects"
import { FilesPage } from "@/pages/files"
import { usePricingRefresh } from "@/hooks/use-pricing-refresh"
import { QuotaPage } from "@/pages/quota"
import { ReliabilityPage } from "@/pages/reliability"
import { SessionsPage } from "@/pages/sessions"
import { SettingsPage } from "@/pages/settings"
import { SkillsPage } from "@/pages/skills"
import { ToolsPage } from "@/pages/tools"
import { useDashboard } from "@/state/dashboard-context"
import { DashboardProvider } from "@/state/dashboard"
import { SettingsProvider } from "@/state/settings"

const PAGES: Record<Page, { title: string; component: () => React.ReactNode }> =
  {
    overview: { title: "Overview", component: OverviewPage },
    activity: { title: "Activity", component: ActivityPage },
    models: { title: "Models", component: ModelsPage },
    agents: { title: "Agents", component: AgentsPage },
    tools: { title: "Tools", component: ToolsPage },
    skills: { title: "Skills", component: SkillsPage },
    projects: { title: "Projects", component: ProjectsPage },
    sessions: { title: "Sessions", component: SessionsPage },
    quota: { title: "Quota", component: QuotaPage },
    files: { title: "Files", component: FilesPage },
    reliability: { title: "Reliability", component: ReliabilityPage },
    settings: { title: "Settings", component: SettingsPage },
  }

function Shell() {
  const [page, setPage] = useState<Page>("overview")
  const [scrolled, setScrolled] = useState(false)
  const { profiles, loadingProfiles, activePath } = useDashboard()
  usePricingRefresh(activePath !== null)
  const Current = PAGES[page].component

  return (
    <SidebarProvider>
      <AppSidebar page={page} onNavigate={setPage} />
      <SidebarInset className="h-svh overflow-hidden">
        <header
          data-slot="app-header"
          data-scrolled={scrolled || undefined}
          className="absolute inset-x-0 top-0 z-20 flex h-14 items-center gap-2 border-b border-transparent bg-background px-4 transition-[background-color,border-color,box-shadow] duration-200 ease-out data-scrolled:border-border supports-backdrop-filter:bg-background/72 supports-backdrop-filter:backdrop-blur-xl supports-backdrop-filter:backdrop-saturate-150 supports-backdrop-filter:data-scrolled:bg-background/80"
        >
          <SidebarTrigger />
          <h1 className="ml-1 text-sm font-semibold tracking-title">
            {PAGES[page].title}
          </h1>
          <div className="ml-auto flex items-center gap-2">
            <ProjectPicker />
            <RangePicker />
            <ProfileMenu />
          </div>
        </header>
        <main
          onScroll={(event) => setScrolled(event.currentTarget.scrollTop > 0)}
          className="min-h-0 flex-1 overflow-auto p-4 pt-18"
        >
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
      <p className="max-w-sm text-center text-sm text-muted-foreground">
        {message}
      </p>
    </div>
  )
}

export function App() {
  return (
    <SettingsProvider>
      <DashboardProvider>
        <TooltipProvider delay={100} closeDelay={0}>
          <Shell />
          <UpdatePrompt />
        </TooltipProvider>
      </DashboardProvider>
    </SettingsProvider>
  )
}

export default App
