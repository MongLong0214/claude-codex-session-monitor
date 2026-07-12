"use client";

import { AlertDialog } from "@astryxdesign/core/AlertDialog";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Icon } from "@astryxdesign/core/Icon";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { useState } from "react";
import type { AgentActionResult, AgentActionType } from "@/domain/agent/actions";
import type { Agent } from "@/domain/agent/agent";
import { useAgentAction } from "@/lib/query/use-agent-action";
import { NO_CONTROL_CHANNEL_REASON, resolveActionAvailability } from "./action-availability";
import styles from "./detail-panel.module.css";

const RESULT_BANNER_STATUS: Record<AgentActionResult["status"], "success" | "warning" | "error"> = {
  success: "success",
  failed: "error",
  skipped: "warning",
};

const RESULT_BANNER_TITLE: Record<AgentActionResult["status"], string> = {
  success: "Action completed",
  failed: "Action failed",
  skipped: "Action skipped",
};

/**
 * Deliberately NOT status-conditional. SIGSTOP/SIGCONT are OS signals; the local adapter's
 * classifier has no evidence to ever report `paused`, so hiding "재개" until the agent looks paused
 * would strand a user who just suspended a process. Both stay visible, both say what they really send.
 */
const SIGNAL_TOOLTIP: Partial<Record<AgentActionType, string>> = {
  pause: "Sends SIGSTOP to pause the process at the OS level. This does not pause the session itself.",
  resume: "Sends SIGCONT to resume the process at the OS level. This does not resume the session itself.",
  open_terminal: "Opens the working directory in Terminal.",
};

/** Exported so the command palette's "stop current agent" reuses the exact same confirmation copy. */
export const STOP_DIALOG_DESCRIPTION =
  "Sends SIGTERM to processes that share this working directory. Because sessions are not mapped directly to processes, this may also stop other sessions in the same directory. This cannot be undone.";

interface AgentActionsProps {
  agent: Agent;
}

export function AgentActions({ agent }: AgentActionsProps) {
  const [isStopDialogOpen, setStopDialogOpen] = useState(false);
  const { mutate, data: result, isPending, error, variables } = useAgentAction();

  const runAction = (action: AgentActionType) => {
    /** No optimisticStatus anywhere here: the adapter can't report `paused`, and `stop` is unpredictable. */
    mutate({ agentId: agent.id, request: { action } });
  };

  const confirmStop = () => {
    setStopDialogOpen(false);
    runAction("stop");
  };

  const renderAction = (action: AgentActionType, label: string) => {
    const { isDisabled, reason } = resolveActionAvailability(agent, action);
    const tooltip = reason ?? SIGNAL_TOOLTIP[action];
    /** Only the in-flight action's own button shows the spinner; the rest merely lock out. */
    const isRunning = isPending && variables?.request.action === action;

    return (
      <Button
        key={action}
        label={label}
        size="sm"
        variant="secondary"
        isDisabled={isDisabled || isPending}
        isLoading={isRunning}
        {...(tooltip ? { tooltip } : {})}
        onClick={() => runAction(action)}
      />
    );
  };

  const stopAvailability = resolveActionAvailability(agent, "stop");

  return (
    <VStack gap={2}>
      <HStack gap={1} wrap="wrap" vAlign="center">
        <Button
          label="Stop"
          size="sm"
          variant="destructive"
          icon={<Icon icon="stop" />}
          isDisabled={stopAvailability.isDisabled || isPending}
          isLoading={isPending && variables?.request.action === "stop"}
          {...(stopAvailability.reason ? { tooltip: stopAvailability.reason } : {})}
          onClick={() => setStopDialogOpen(true)}
        />
        {renderAction("pause", "Pause (SIGSTOP)")}
        {renderAction("resume", "Resume (SIGCONT)")}
        {renderAction("open_terminal", "Open Terminal")}
        {renderAction("retry", "Retry")}
        {renderAction("approve", "Approve")}
        {renderAction("reject", "Reject")}
      </HStack>

      {/* The disabled buttons carry this as a tooltip, but a hover-only explanation is not enough. */}
      <Text type="supporting" as="p" className={styles.reasonNote}>
        Retry, Approve, and Reject are always unavailable. {NO_CONTROL_CHANNEL_REASON}
      </Text>

      {error ? (
        <Banner container="section" status="error" title="Could not send request" description={error.message} />
      ) : null}

      {result && !error ? (
        <Banner
          container="section"
          status={RESULT_BANNER_STATUS[result.status]}
          title={RESULT_BANNER_TITLE[result.status]}
          description={result.message}
        />
      ) : null}

      <AlertDialog
        isOpen={isStopDialogOpen}
        onOpenChange={setStopDialogOpen}
        title={`Stop ${agent.displayName}?`}
        description={STOP_DIALOG_DESCRIPTION}
        actionLabel="Stop"
        cancelLabel="Cancel"
        actionVariant="destructive"
        isActionLoading={isPending}
        onAction={confirmStop}
      />
    </VStack>
  );
}
