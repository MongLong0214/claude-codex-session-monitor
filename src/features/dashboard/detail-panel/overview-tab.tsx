"use client";

import { Badge } from "@astryxdesign/core/Badge";
import { MetadataList, MetadataListItem } from "@astryxdesign/core/MetadataList";
import { ProgressBar } from "@astryxdesign/core/ProgressBar";
import { VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { Tooltip } from "@astryxdesign/core/Tooltip";
import type { Agent } from "@/domain/agent/agent";
import { EnglishTimestamp } from "../english-timestamp";
import { STATUS_LABEL } from "../status-presentation";
import styles from "./detail-panel.module.css";
import { EMPTY_VALUE, formatCost, formatElapsed, formatTokens, retryCount, shortCommitSha, statusReason, statusTimestamp } from "./format";

/**
 * Codex emits no percent-complete signal, so a running agent gets an indeterminate bar and a
 * completed one a full success bar. No other state gets a bar at all — a fabricated number would
 * read as authoritative. Confirmed against domain/agent/agent.ts: there is no progress field.
 */
function StatusProgress({ agent }: { agent: Agent }) {
  if (agent.status.kind === "running") {
    return <ProgressBar label="Progress (percentage unavailable)" isIndeterminate variant="success" />;
  }

  if (agent.status.kind === "completed") {
    return <ProgressBar label="Completed" value={100} variant="neutral" />;
  }

  return null;
}

/** Derived only from parentId/childIds — the domain model has no other dependency concept. */
function RelatedWork({ agent }: { agent: Agent }) {
  if (agent.role === "subagent") {
    return <Badge variant="info" label="Child agent of parent session" />;
  }

  if (agent.childIds.length > 0) {
    return <Badge variant="neutral" label={`Child agents: ${agent.childIds.length}`} />;
  }

  return <>{EMPTY_VALUE}</>;
}

interface OverviewTabProps {
  agent: Agent;
  /** Injected so elapsed time is computed from one clock per render pass, and stays testable. */
  nowMs: number;
}

export function OverviewTab({ agent, nowMs }: OverviewTabProps) {
  const lastSignalAt = statusTimestamp(agent.status);
  const reason = statusReason(agent.status);
  const retries = retryCount(agent.status);
  const shortSha = shortCommitSha(agent.commitSha);

  return (
    <VStack gap={4}>
      <StatusProgress agent={agent} />

      {reason ? (
        <VStack gap={0.5}>
          <Text type="label">{agent.status.kind === "failed" ? "Failure reason" : "Blocked by"}</Text>
          <Text type="body" as="p" className={styles.wrapAnywhere}>
            {reason}
          </Text>
        </VStack>
      ) : null}

      <MetadataList columns="single" label={{ position: "start", width: 120 }}>
        <MetadataListItem label="Status">{STATUS_LABEL[agent.status.kind]}</MetadataListItem>

        <MetadataListItem label="Last signal">
          {lastSignalAt ? <EnglishTimestamp value={lastSignalAt} isLive /> : EMPTY_VALUE}
        </MetadataListItem>

        <MetadataListItem label="Runtime">
          <Text type="code">{formatElapsed(agent.startedAt, nowMs)}</Text>
        </MetadataListItem>

        <MetadataListItem label="Started">
          <EnglishTimestamp value={agent.startedAt} format="date_time" />
        </MetadataListItem>

        <MetadataListItem label="Token usage">
          <Text type="code" hasTabularNumbers>
            {formatTokens(agent.tokensUsed)}
          </Text>
        </MetadataListItem>

        {/* Null in real/local mode — Codex's state DB has no pricing data. Not a bug. */}
        <MetadataListItem label="Cost">
          <Text type="code" hasTabularNumbers>
            {formatCost(agent.costUsd)}
          </Text>
        </MetadataListItem>

        {retries === null ? null : (
          <MetadataListItem label="Retry count">
            <Text type="code" hasTabularNumbers>
              {retries}
            </Text>
          </MetadataListItem>
        )}

        <MetadataListItem label="Commit">
          {shortSha && agent.commitSha ? (
            <Tooltip content={agent.commitSha}>
              <Text type="code">{shortSha}</Text>
            </Tooltip>
          ) : (
            EMPTY_VALUE
          )}
        </MetadataListItem>

        <MetadataListItem label="Model">{agent.model ?? EMPTY_VALUE}</MetadataListItem>
        <MetadataListItem label="Reasoning effort">{agent.reasoningEffort ?? EMPTY_VALUE}</MetadataListItem>
        <MetadataListItem label="Approval mode">{agent.approvalMode ?? EMPTY_VALUE}</MetadataListItem>
        <MetadataListItem label="CLI version">{agent.cliVersion ?? EMPTY_VALUE}</MetadataListItem>

        <MetadataListItem label="Related work">
          <RelatedWork agent={agent} />
        </MetadataListItem>

        <MetadataListItem label="Process PIDs">
          {agent.runtimePids.length > 0 ? <Text type="code">{agent.runtimePids.join(", ")}</Text> : EMPTY_VALUE}
        </MetadataListItem>

        <MetadataListItem label="Working directory">
          <Text type="code" className={styles.wrapAnywhere}>
            {agent.project.cwd || EMPTY_VALUE}
          </Text>
        </MetadataListItem>
      </MetadataList>
    </VStack>
  );
}
