"use client";

import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Icon } from "@astryxdesign/core/Icon";
import { SegmentedControl, SegmentedControlItem } from "@astryxdesign/core/SegmentedControl";
import { Spinner } from "@astryxdesign/core/Spinner";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { useEffect, useMemo, useRef, useState } from "react";
import type { AgentId } from "@/domain/agent/agent";
import { EnglishTimestamp } from "../english-timestamp";
import type { AgentLogLevel, AgentLogLine } from "@/domain/agent/logs";
import { DEFAULT_AGENT_LOG_LIMIT } from "@/domain/agent/logs";
import { useAgentLogs } from "@/lib/query/use-agent-logs";
import styles from "./logs-tab.module.css";

type LevelFilter = "all" | AgentLogLevel;
type CopyFeedback =
  | { readonly scope: symbol; readonly kind: "copied" }
  | { readonly scope: symbol; readonly kind: "error"; readonly message: string };

/** Within this distance of the bottom the view counts as "following"; further up it is "reading". */
const PINNED_THRESHOLD_PX = 24;
const COPIED_FEEDBACK_MS = 2_000;

/**
 * The severity filter is structurally present but only "전체"/"정보" can ever match: neither Codex's
 * rollout events nor Claude Code's session JSONL carry a severity field (see domain/agent/logs.ts),
 * so every line either reader emits is "info". The two unreachable segments are disabled rather
 * than silently returning zero rows, and no keyword-guessing classifier is used to fake them.
 */
const UNREACHABLE_LEVEL_REASON = "This session's log format has no severity field, so warning and error levels cannot be distinguished.";

function toClipboardText(lines: readonly AgentLogLine[]): string {
  return lines.map((line) => `${line.timestamp ?? ""}\t${line.text}`).join("\n");
}

/**
 * Mounted only while its tab is selected and the panel is open — that mount IS the lazy-load
 * boundary, so the log query never runs for a closed panel or an unselected tab.
 */
export function LogsTab({ agentId }: { agentId: AgentId }) {
  const [levelFilter, setLevelFilter] = useState<LevelFilter>("all");
  const [copyFeedback, setCopyFeedback] = useState<CopyFeedback | null>(null);

  const { data, isLoading, isError, error, refetch, isFetching } = useAgentLogs(agentId, { isEnabled: true });

  const scrollRef = useRef<HTMLElement>(null);
  const isPinnedRef = useRef(true);
  const copyAttemptRef = useRef(0);
  const copyScope = useMemo(() => Symbol(agentId), [agentId]);
  const copyScopeRef = useRef(copyScope);

  const lines = data?.lines ?? [];
  const visibleLines = levelFilter === "all" ? lines : lines.filter((line) => line.level === levelFilter);
  const currentCopyFeedback = copyFeedback?.scope === copyScope ? copyFeedback : null;
  const isCopied = currentCopyFeedback?.kind === "copied";
  const copyError = currentCopyFeedback?.kind === "error" ? currentCopyFeedback.message : null;

  /** Follow new output only when the user is already at the bottom; never yank them out of history. */
  useEffect(() => {
    const region = scrollRef.current;
    if (region && isPinnedRef.current) {
      region.scrollTop = region.scrollHeight;
    }
  }, [visibleLines]);

  useEffect(() => {
    copyScopeRef.current = copyScope;
    copyAttemptRef.current += 1;
  }, [copyScope]);

  useEffect(() => {
    if (copyFeedback?.kind !== "copied") {
      return;
    }

    const timer = window.setTimeout(() => setCopyFeedback(null), COPIED_FEEDBACK_MS);
    return () => window.clearTimeout(timer);
  }, [copyFeedback]);

  const handleScroll = () => {
    const region = scrollRef.current;
    if (region) {
      isPinnedRef.current = region.scrollHeight - region.scrollTop - region.clientHeight <= PINNED_THRESHOLD_PX;
    }
  };

  const handleCopy = async () => {
    const attempt = ++copyAttemptRef.current;
    setCopyFeedback(null);
    try {
      await navigator.clipboard.writeText(toClipboardText(visibleLines));
      if (attempt === copyAttemptRef.current && copyScopeRef.current === copyScope) {
        setCopyFeedback({ scope: copyScope, kind: "copied" });
      }
    } catch (error) {
      if (attempt === copyAttemptRef.current && copyScopeRef.current === copyScope) {
        setCopyFeedback({
          scope: copyScope,
          kind: "error",
          message: error instanceof Error && error.message ? error.message : "Unknown error",
        });
      }
    }
  };

  return (
    <VStack gap={2} height="100%">
      <HStack gap={2} vAlign="center" hAlign="between" wrap="wrap">
        <SegmentedControl
          size="sm"
          label="Log severity"
          value={levelFilter}
          onChange={(value) => setLevelFilter(value as LevelFilter)}
        >
          <SegmentedControlItem value="all" label="All" />
          <SegmentedControlItem value="info" label="Info" />
          <SegmentedControlItem value="warning" label="Warning" isDisabled />
          <SegmentedControlItem value="error" label="Error" isDisabled />
        </SegmentedControl>

        <HStack gap={1} vAlign="center">
          <Button
            label="Refresh"
            size="sm"
            variant="ghost"
            isLoading={isFetching}
            onClick={() => {
              void refetch();
            }}
          />
          <Button
            label={isCopied ? "Copied" : "Copy"}
            size="sm"
            variant="ghost"
            icon={<Icon icon={isCopied ? "checkDouble" : "copy"} />}
            isDisabled={visibleLines.length === 0}
            onClick={() => {
              void handleCopy();
            }}
          />
        </HStack>
      </HStack>

      <Text type="supporting" as="p">
        {UNREACHABLE_LEVEL_REASON} Showing the latest {DEFAULT_AGENT_LOG_LIMIT} lines.
      </Text>

      {copyError ? (
        <Banner container="section" status="error" title="Could not copy logs" description={copyError} />
      ) : null}

      {data?.isTruncated ? (
        <Banner
          container="section"
          status="info"
          title="Older logs omitted"
          description="Only the final segment of the rollout file is read, so earlier entries are not available here."
        />
      ) : null}

      {isError ? (
        <Banner
          container="section"
          status="error"
          title="Could not load logs"
          description={error instanceof Error ? error.message : "Unknown error"}
        />
      ) : null}

      {isLoading ? (
        <Spinner size="md" label="Loading logs" />
      ) : (
        <VStack
          ref={scrollRef}
          className={styles.scrollRegion}
          onScroll={handleScroll}
          /* role="log" already implies aria-live="polite"; stable line ids mean only new rows announce. */
          role="log"
          aria-label="Agent activity log"
          tabIndex={0}
        >
          {visibleLines.length === 0 ? (
            <EmptyState isCompact title="No logs to display" description="No readable activity has been recorded in this session's rollout file yet." />
          ) : (
            <ol className={styles.lineList}>
              {visibleLines.map((line) => (
                <li key={line.id} className={styles.line}>
                  {line.timestamp ? (
                    <EnglishTimestamp value={line.timestamp} format="system_time" hasTooltip={false} />
                  ) : (
                    <Text type="supporting">—</Text>
                  )}
                  <Text type="code" className={styles.lineText}>
                    {line.text}
                  </Text>
                </li>
              ))}
            </ol>
          )}
        </VStack>
      )}
    </VStack>
  );
}
