"use client";

import { Banner } from "@astryxdesign/core/Banner";
import { Center } from "@astryxdesign/core/Center";
import { Skeleton } from "@astryxdesign/core/Skeleton";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { AgentStatusKind } from "@/domain/agent/status";
import type { Incident } from "@/domain/incident/incident";
import type { DashboardSettings } from "@/domain/settings";
import { useDashboardSnapshot } from "@/lib/query/use-dashboard-snapshot";
import { useRealtimeSync } from "@/lib/query/use-realtime-sync";
import { DashboardWorkspace } from "./dashboard-workspace";
import { deriveCriticalIncidents, deriveProjectNavEntries } from "./selectors";
import { DashboardAppShell } from "./shell/dashboard-app-shell";
import type { DashboardView } from "./shell/side-nav";
import { SEARCH_INPUT_ID } from "./table/table-toolbar";

interface DashboardRootProps {
  settings: DashboardSettings;
  onUpdateSettings: (patch: Partial<DashboardSettings>) => void;
}

const SKELETON_ROWS = Array.from({ length: 10 }, (_, index) => index);

export function DashboardLoadingState({ label = "Loading dashboard" }: { label?: string }) {
  return (
    <VStack gap={0} height="100vh" role="status" aria-label={label} className="precisionSkeleton">
      <HStack gap={3} vAlign="center" height={44} paddingInline={3} className="precisionSkeletonHeader">
        <Skeleton width={220} height={20} radius={1} />
        <Skeleton width="42%" height={24} radius={1} />
        <Skeleton width={148} height={24} radius={1} />
      </HStack>
      <HStack gap={0} height="100%" vAlign="stretch" className="precisionSkeletonBody">
        <VStack gap={3} width={256} padding={3} className="precisionSkeletonNav">
          <Skeleton width={72} height={12} radius={1} />
          <Skeleton width="100%" height={28} radius={1} />
          <Skeleton width="100%" height={28} radius={1} />
          <Skeleton width={64} height={12} radius={1} />
          <Skeleton width="84%" height={28} radius={1} />
          <Skeleton width="72%" height={28} radius={1} />
          <Skeleton width="92%" height={28} radius={1} />
        </VStack>
        <VStack gap={0} width="100%" className="precisionSkeletonContent">
          <HStack gap={2} vAlign="center" padding={3}>
            <Skeleton width={260} height={28} radius={1} />
            <Skeleton width={96} height={28} radius={1} />
            <Skeleton width={96} height={28} radius={1} />
            <Skeleton width={120} height={28} radius={1} />
          </HStack>
          {SKELETON_ROWS.map((row) => (
            <HStack key={row} gap={3} vAlign="center" height={36} paddingInline={3}>
              <Skeleton width={84} height={12} radius={1} />
              <Skeleton width={180} height={12} radius={1} />
              <Skeleton width={160} height={12} radius={1} />
              <Skeleton width="36%" height={12} radius={1} />
              <Skeleton width={96} height={12} radius={1} />
            </HStack>
          ))}
        </VStack>
      </HStack>
    </VStack>
  );
}

/** "/" focuses the table search — but not while the user is already typing into a field. */
function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  return (
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT" ||
    target.isContentEditable
  );
}

export function DashboardRoot({ settings, onUpdateSettings }: DashboardRootProps) {
  const { data, isLoading, isError, error } = useDashboardSnapshot();
  const { status: connectionStatus } = useRealtimeSync();

  const projectFilterCwd = settings.projectFilter[0] ?? null;
  const [selectedView, setSelectedView] = useState<DashboardView>(() =>
    projectFilterCwd === null ? "all" : { projectCwd: projectFilterCwd },
  );
  const [lastProjectFilterCwd, setLastProjectFilterCwd] = useState(projectFilterCwd);
  if (projectFilterCwd !== lastProjectFilterCwd) {
    setLastProjectFilterCwd(projectFilterCwd);
    if (selectedView !== "incidents") {
      setSelectedView(projectFilterCwd === null ? "all" : { projectCwd: projectFilterCwd });
    }
  }
  const [isCommandPaletteOpen, setCommandPaletteOpen] = useState(false);

  const toggleStatusFilter = useCallback(
    (status: AgentStatusKind) => {
      const current = settings.statusFilter;
      onUpdateSettings({
        statusFilter: current.includes(status) ? current.filter((value) => value !== status) : [...current, status],
      });
    },
    [onUpdateSettings, settings.statusFilter],
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandPaletteOpen((open) => !open);
        return;
      }
      if (event.key === "/" && !event.metaKey && !event.ctrlKey && !event.altKey && !isEditableTarget(event.target)) {
        const input = document.querySelector(`[data-search-input-id="${SEARCH_INPUT_ID}"]`);
        if (input instanceof HTMLInputElement) {
          event.preventDefault();
          input.focus();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const projects = useMemo(() => (data ? deriveProjectNavEntries(data) : []), [data]);
  const criticalIncidents = useMemo(() => (data ? deriveCriticalIncidents(data.incidents) : []), [data]);

  const handleSelectIncident = useCallback((incident: Incident) => {
    setSelectedView({ projectCwd: incident.affectedProjectIds[0] ?? "" });
  }, []);

  if (isError && !data) {
    return (
      <Center height="100vh">
        <VStack width="100%" maxWidth={600} padding={4}>
          <Banner
            status="error"
            title="Dashboard unavailable"
            description={error instanceof Error ? error.message : "An unknown error occurred."}
          />
        </VStack>
      </Center>
    );
  }

  if (isLoading || !data) {
    return <DashboardLoadingState />;
  }

  return (
    <DashboardAppShell
      summary={data.summary}
      statusFilter={settings.statusFilter}
      onToggleStatusFilter={toggleStatusFilter}
      connectionStatus={connectionStatus}
      lastSyncedAt={data.lastSyncedAt}
      onOpenCommandPalette={() => setCommandPaletteOpen(true)}
      isSidebarCollapsed={settings.sidebarCollapsed}
      onSidebarCollapsedChange={(isCollapsed) => onUpdateSettings({ sidebarCollapsed: isCollapsed })}
      selectedView={selectedView}
      onSelectAll={() => {
        setSelectedView("all");
        onUpdateSettings({ projectFilter: [] });
      }}
      onSelectIncidents={() => setSelectedView("incidents")}
      onSelectProject={(cwd) => {
        setSelectedView({ projectCwd: cwd });
        onUpdateSettings({ projectFilter: [cwd] });
      }}
      projects={projects}
      criticalIncidents={criticalIncidents}
      onSelectIncident={handleSelectIncident}
    >
      <DashboardWorkspace
        settings={settings}
        onUpdateSettings={onUpdateSettings}
        isCommandPaletteOpen={isCommandPaletteOpen}
        onCommandPaletteOpenChange={setCommandPaletteOpen}
      />
    </DashboardAppShell>
  );
}
