"use client";

import { AlertDialog } from "@astryxdesign/core/AlertDialog";
import { CommandPalette } from "@astryxdesign/core/CommandPalette";
import { useToast } from "@astryxdesign/core/Toast";
import { createStaticSource } from "@astryxdesign/core/Typeahead";
import { useCallback, useMemo, useState } from "react";
import type { AgentActionType } from "@/domain/agent/actions";
import type { Agent, AgentId } from "@/domain/agent/agent";
import type { RowDensity, ThemeMode } from "@/domain/settings";
import { useAgentAction } from "@/lib/query/use-agent-action";
import { useDashboardSnapshot } from "@/lib/query/use-dashboard-snapshot";
import { STOP_DIALOG_DESCRIPTION } from "../detail-panel/agent-actions";
import { buildCommandItems, type CommandDescriptor } from "./command-items";

export interface DashboardCommandPaletteProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  /** The agent whose detail panel is open — the target of the "current agent" commands. */
  selectedAgentId: AgentId | null;
  onOpenAgentDetail: (agentId: AgentId) => void;
  onApplyProjectFilter: (cwd: string) => void;
  onApplyBranchFilter: (branch: string) => void;
  onSetTheme: (theme: ThemeMode) => void;
  onSetDensity: (density: RowDensity) => void;
}

/**
 * Cmd/Ctrl+K launcher over the same normalized snapshot the table reads — no second data path.
 * Search spans agents, projects and branches; the finite command set changes theme, density and
 * (when an agent's detail panel is open and it has a live process) runs a control action on it.
 *
 * The palette auto-closes on select, so each command's effect runs through the `run` closure the
 * item carries. `stop` is the one action that does not fire immediately: it opens the same
 * SIGTERM confirmation the detail panel uses (shared copy, shared `useAgentAction`), never a
 * parallel stop path. Action outcomes surface through `useToast()`, backed by the single shared
 * `ToastViewport` mounted once in `dashboard-root.tsx` — not a local one here, which would double
 * up the `role="region" aria-label="Notifications"` landmark (a real axe-core violation) once this
 * palette and the table are both mounted at the same time.
 */
export function DashboardCommandPalette({
  isOpen,
  onOpenChange,
  selectedAgentId,
  onOpenAgentDetail,
  onApplyProjectFilter,
  onApplyBranchFilter,
  onSetTheme,
  onSetDensity,
}: DashboardCommandPaletteProps) {
  const { data } = useDashboardSnapshot();
  const showToast = useToast();
  const { mutate: runAgentAction, isPending: isActionPending } = useAgentAction();
  const [stopTarget, setStopTarget] = useState<Agent | null>(null);

  const currentAgent = useMemo(
    () => (data && selectedAgentId ? (data.byId[selectedAgentId] ?? null) : null),
    [data, selectedAgentId],
  );

  /** pause/resume mirror the detail panel: no optimistic patch, outcome surfaced verbatim as a toast. */
  const runAgentActionCommand = useCallback(
    (agent: Agent, action: AgentActionType) => {
      if (action === "stop") {
        setStopTarget(agent);
        return;
      }
      runAgentAction(
        { agentId: agent.id, request: { action } },
        {
          onSuccess: (result) =>
            showToast({
              body: result.message,
              type: result.status === "failed" ? "error" : "info",
              uniqueID: `${result.agentId}:${result.action}`,
            }),
          onError: (error) => showToast({ body: `Unable to run action: ${error.message}`, type: "error" }),
        },
      );
    },
    [runAgentAction, showToast],
  );

  const confirmStop = useCallback(() => {
    const agent = stopTarget;
    if (!agent) {
      return;
    }
    setStopTarget(null);
    runAgentAction(
      { agentId: agent.id, request: { action: "stop" } },
      {
        onSuccess: (result) =>
          showToast({
            body: result.message,
            type: result.status === "failed" ? "error" : "info",
            uniqueID: `${result.agentId}:${result.action}`,
          }),
        onError: (error) => showToast({ body: `Unable to send stop request: ${error.message}`, type: "error" }),
      },
    );
  }, [stopTarget, runAgentAction, showToast]);

  const descriptors = useMemo(
    () =>
      buildCommandItems({
        snapshot: data,
        currentAgent,
        callbacks: {
          onOpenAgentDetail,
          onApplyProjectFilter,
          onApplyBranchFilter,
          onSetTheme,
          onSetDensity,
          onRunAgentAction: runAgentActionCommand,
        },
      }),
    [
      data,
      currentAgent,
      onOpenAgentDetail,
      onApplyProjectFilter,
      onApplyBranchFilter,
      onSetTheme,
      onSetDensity,
      runAgentActionCommand,
    ],
  );

  const searchSource = useMemo(
    () => createStaticSource(descriptors, { keywords: (item) => item.auxiliaryData?.keywords ?? [] }),
    [descriptors],
  );

  const runById = useMemo(() => new Map(descriptors.map((item) => [item.id, item.run])), [descriptors]);

  const handleValueChange = useCallback((value: string) => runById.get(value)?.(), [runById]);

  return (
    <>
      <CommandPalette<CommandDescriptor>
        isOpen={isOpen}
        onOpenChange={onOpenChange}
        searchSource={searchSource}
        onValueChange={handleValueChange}
        label="Command palette"
        emptySearchText="No results found"
        emptyBootstrapText="No commands available"
      />

      <AlertDialog
        isOpen={stopTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setStopTarget(null);
          }
        }}
        title={stopTarget ? `Stop ${stopTarget.displayName}` : "Stop agent"}
        description={STOP_DIALOG_DESCRIPTION}
        actionLabel="Stop"
        cancelLabel="Cancel"
        actionVariant="destructive"
        isActionLoading={isActionPending}
        onAction={confirmStop}
      />
    </>
  );
}
