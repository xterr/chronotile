import {
  Activity,
  Bot,
  Cpu,
  FolderGit2,
  LayoutDashboard,
  ListTree,
  Settings,
  ShieldAlert,
  Wrench,
} from "lucide-react"

import { Logo } from "@/components/logo"

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"

export type Page =
  | "overview"
  | "activity"
  | "models"
  | "agents"
  | "tools"
  | "projects"
  | "sessions"
  | "reliability"
  | "settings"

const NAV: { page: Page; label: string; icon: typeof LayoutDashboard }[] = [
  { page: "overview", label: "Overview", icon: LayoutDashboard },
  { page: "activity", label: "Activity", icon: Activity },
  { page: "models", label: "Models", icon: Cpu },
  { page: "agents", label: "Agents", icon: Bot },
  { page: "tools", label: "Tools", icon: Wrench },
  { page: "projects", label: "Projects", icon: FolderGit2 },
  { page: "sessions", label: "Sessions", icon: ListTree },
  { page: "reliability", label: "Reliability", icon: ShieldAlert },
]

interface AppSidebarProps {
  page: Page
  onNavigate: (page: Page) => void
}

export function AppSidebar({ page, onNavigate }: AppSidebarProps) {
  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <div className="flex items-center gap-2 overflow-hidden px-2 py-1.5 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0">
          <Logo className="size-5 shrink-0" />
          <span className="text-sm font-semibold whitespace-nowrap group-data-[collapsible=icon]:hidden">
            Chronotile
          </span>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Dashboard</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {NAV.map((item) => (
                <SidebarMenuItem key={item.page}>
                  <SidebarMenuButton
                    isActive={page === item.page}
                    tooltip={item.label}
                    onClick={() => onNavigate(item.page)}
                  >
                    <item.icon />
                    <span>{item.label}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              isActive={page === "settings"}
              tooltip="Settings"
              onClick={() => onNavigate("settings")}
            >
              <Settings />
              <span>Settings</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  )
}
