"use client";

import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { CodeBlock } from "@astryxdesign/core/CodeBlock";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Spinner } from "@astryxdesign/core/Spinner";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { useEffect, useRef } from "react";
import type { AgentActionResult, AgentActionType } from "@/domain/agent/actions";
import type { Agent } from "@/domain/agent/agent";
import { useAgentAction } from "@/lib/query/use-agent-action";
import { resolveActionAvailability } from "./action-availability";

/** Read-only `git status --short` output, already truncated server-side. "변경 사항이 없습니다." is a success too. */
function DiffOutput({ result }: { result: AgentActionResult }) {
  if (result.status === "success") {
    return <CodeBlock code={result.message} language="plaintext" container="section" width="100%" size="sm" isWrapped maxHeight={360} />;
  }

  return (
    <Banner
      container="section"
      status={result.status === "skipped" ? "warning" : "error"}
      title="Could not inspect changes"
      description={result.message}
    />
  );
}

/**
 * There is no live working-tree feed or GET endpoint for one: `view_diff` runs read-only
 * `git status --short` in the agent's cwd and answers through the action result. What renders below
 * is therefore a point-in-time snapshot, taken when this tab opened or the user pressed 새로고침.
 */
export function ChangesTab({ agent }: { agent: Agent }) {
  const diff = useAgentAction();
  const pullRequest = useAgentAction();

  const { mutate: runDiff } = diff;
  const lastLoadedAgentId = useRef<string | null>(null);

  useEffect(() => {
    if (lastLoadedAgentId.current === agent.id) {
      return;
    }

    lastLoadedAgentId.current = agent.id;
    runDiff({ agentId: agent.id, request: { action: "view_diff" } });
  }, [agent.id, runDiff]);

  const renderPullRequestAction = (action: AgentActionType, label: string) => {
    const { isDisabled, reason } = resolveActionAvailability(agent, action);

    return (
      <Button
        label={label}
        size="sm"
        variant="secondary"
        isDisabled={isDisabled || pullRequest.isPending}
        isLoading={pullRequest.isPending && pullRequest.variables?.request.action === action}
        {...(reason ? { tooltip: reason } : {})}
        onClick={() => pullRequest.mutate({ agentId: agent.id, request: { action } })}
      />
    );
  };

  const diffAvailability = resolveActionAvailability(agent, "view_diff");

  return (
    <VStack gap={3}>
      <HStack gap={1} wrap="wrap" vAlign="center">
        <Button
          label="Refresh"
          size="sm"
          variant="secondary"
          isDisabled={diffAvailability.isDisabled || diff.isPending}
          isLoading={diff.isPending}
          {...(diffAvailability.reason ? { tooltip: diffAvailability.reason } : {})}
          onClick={() => diff.mutate({ agentId: agent.id, request: { action: "view_diff" } })}
        />
        {renderPullRequestAction("create_pr", "Create PR")}
        {renderPullRequestAction("open_pr", "Open PR")}
      </HStack>

      <Text type="supporting" as="p">
        {agent.branch ? `Branch ${agent.branch}. ` : ""}This is the working tree output from git status --short. It is a point-in-time
        snapshot and does not update in real time.
      </Text>

      {/* gh can be missing, unauthenticated, or have nothing to PR — surface its real message. */}
      {pullRequest.error ? (
        <Banner container="section" status="error" title="Could not send request" description={pullRequest.error.message} />
      ) : null}

      {pullRequest.data && !pullRequest.error ? (
        <Banner
          container="section"
          status={pullRequest.data.status === "success" ? "success" : "error"}
          title={pullRequest.data.status === "success" ? "Completed" : "Failed"}
          description={pullRequest.data.message}
        />
      ) : null}

      {diff.isPending ? <Spinner size="md" label="Reading changes" /> : null}

      {diff.error ? (
        <Banner container="section" status="error" title="Could not load working tree status" description={diff.error.message} />
      ) : null}

      {diff.data && !diff.isPending && !diff.error ? <DiffOutput result={diff.data} /> : null}

      {!diff.data && !diff.isPending && !diff.error ? (
        <EmptyState isCompact title="Changes not loaded" description="Refresh to inspect the current working tree." />
      ) : null}
    </VStack>
  );
}
