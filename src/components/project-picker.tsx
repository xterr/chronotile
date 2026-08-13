import { useMemo } from "react"

import { Button } from "@/components/ui/button"
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
  ComboboxValue,
} from "@/components/ui/combobox"
import { projectDisplayName } from "@/lib/paths"
import { useDashboard } from "@/state/dashboard-context"

interface ProjectEntry {
  id: string | null
  label: string
}

export function ProjectPicker() {
  const { projectOptions, selectedProject, selectProject } = useDashboard()

  const items = useMemo<ProjectEntry[]>(
    () => [
      { id: null, label: "All projects" },
      ...projectOptions.map((option) => ({
        id: option.projectId,
        label: projectDisplayName(option.name, option.worktree),
      })),
    ],
    [projectOptions],
  )

  const value = items.find((item) => item.id === selectedProject) ?? items[0]

  return (
    <Combobox
      items={items}
      value={value}
      onValueChange={(next: ProjectEntry | null) => {
        selectProject(next?.id ?? null)
      }}
      itemToStringLabel={(item: ProjectEntry) => item.label}
    >
      <ComboboxTrigger
        render={
          <Button
            variant="outline"
            size="sm"
            className="w-44 justify-between font-normal"
          />
        }
      >
        <span className="truncate">
          <ComboboxValue />
        </span>
      </ComboboxTrigger>
      <ComboboxContent className="w-auto min-w-(--anchor-width) max-w-96">
        <ComboboxInput showTrigger={false} placeholder="Search projects…" />
        <ComboboxEmpty>No projects found.</ComboboxEmpty>
        <ComboboxList>
          {(item: ProjectEntry) => (
            <ComboboxItem key={item.id ?? "__all__"} value={item}>
              <span className="whitespace-nowrap">{item.label}</span>
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  )
}
