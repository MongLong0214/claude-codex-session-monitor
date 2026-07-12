import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeProvider } from "@/components/providers/theme-provider";
import { buildMockSnapshot } from "@/data-access/mock-adapter";
import type { AgentId } from "@/domain/agent/agent";
import type { DashboardSnapshot } from "@/domain/dashboard";
import { dashboardKeys } from "@/lib/query/keys";
import { createQueryClient } from "@/lib/query/query-client";
import { DetailPanel } from "./detail-panel";

vi.mock("@/lib/query/api", () => ({
  fetchDashboardSnapshot: vi.fn(),
  fetchAgentLogs: vi.fn(),
  postAgentAction: vi.fn(),
  postBulkAgentAction: vi.fn(),
}));

import { fetchAgentLogs, fetchDashboardSnapshot, postAgentAction } from "@/lib/query/api";

/** Reuses the project's shared deterministic fixture instead of inventing new test data. */
const NOW_MS = Date.parse("2026-07-10T12:00:00.000Z");
const SNAPSHOT: DashboardSnapshot = buildMockSnapshot(NOW_MS);

/** Codex agent with an observed runtime pid — pause/resume/stop should be enabled. */
const CODEX_AGENT_ID: AgentId = "mock-main-monitor";
/** Claude-Code-sourced agent — runtimePids is always [] for this source, so process-signal
 * actions must render disabled with a reason (see action-availability.ts). */
const CLAUDE_CODE_AGENT_ID: AgentId = "mock-claude-refactor";

function renderPanel(
  agentId: AgentId | null,
  options: { onClose?: () => void; restoreFocusRef?: React.RefObject<HTMLElement | null> } = {},
) {
  const { onClose = vi.fn(), restoreFocusRef } = options;
  const queryClient = createQueryClient();
  queryClient.setQueryData(dashboardKeys.snapshot(), SNAPSHOT);

  const utils = render(
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <DetailPanel agentId={agentId} onClose={onClose} {...(restoreFocusRef ? { restoreFocusRef } : {})} />
      </QueryClientProvider>
    </ThemeProvider>,
  );

  return { ...utils, queryClient, onClose };
}

beforeEach(() => {
  vi.mocked(fetchDashboardSnapshot).mockResolvedValue(SNAPSHOT);
  vi.mocked(fetchAgentLogs).mockResolvedValue({ agentId: CODEX_AGENT_ID, lines: [], isTruncated: false });
  vi.mocked(postAgentAction).mockResolvedValue({
    agentId: CODEX_AGENT_ID,
    action: "view_diff",
    status: "success",
    message: "No changes.",
  });
});

describe("DetailPanel open/close", () => {
  it("AC: renders nothing when agentId is null", () => {
    renderPanel(null);
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
  });

  it("AC: opening the panel with an agent id shows that agent's name and status", async () => {
    renderPanel(CODEX_AGENT_ID);

    const panel = await screen.findByRole("complementary", { name: "Agent details" });
    expect(panel).toHaveTextContent("Migrate Codex Session Monitor");
    expect(panel).toHaveTextContent("Running");
  });

  it("AC: the close button calls onClose", async () => {
    const user = userEvent.setup();
    const { onClose } = renderPanel(CODEX_AGENT_ID);
    await screen.findByRole("complementary", { name: "Agent details" });

    await user.click(screen.getByRole("button", { name: "Close detail panel" }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("AC: the close button restores focus to restoreFocusRef's element when one is supplied", async () => {
    const user = userEvent.setup();

    function Harness() {
      const triggerRef = useRef<HTMLButtonElement>(null);
      return (
        <>
          <button ref={triggerRef} type="button">
            Open details trigger
          </button>
          <DetailPanel agentId={CODEX_AGENT_ID} onClose={vi.fn()} restoreFocusRef={triggerRef} />
        </>
      );
    }

    const queryClient = createQueryClient();
    queryClient.setQueryData(dashboardKeys.snapshot(), SNAPSHOT);
    render(
      <ThemeProvider>
        <QueryClientProvider client={queryClient}>
          <Harness />
        </QueryClientProvider>
      </ThemeProvider>,
    );

    await screen.findByRole("complementary", { name: "Agent details" });
    await user.click(screen.getByRole("button", { name: "Close detail panel" }));

    expect(screen.getByRole("button", { name: "Open details trigger" })).toHaveFocus();
  });

  it("AC: without restoreFocusRef, closing still calls onClose and does not throw", async () => {
    const user = userEvent.setup();
    const { onClose } = renderPanel(CODEX_AGENT_ID);
    await screen.findByRole("complementary", { name: "Agent details" });

    await user.click(screen.getByRole("button", { name: "Close detail panel" }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("AC: pressing Escape closes the panel the same way the close button does", async () => {
    const user = userEvent.setup();
    const { onClose } = renderPanel(CODEX_AGENT_ID);
    await screen.findByRole("complementary", { name: "Agent details" });

    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledOnce();
  });
});

describe("DetailPanel loading/empty states", () => {
  it("AC: shows a loading spinner while the agent has not resolved yet", async () => {
    let resolveSnapshot!: (snapshot: DashboardSnapshot) => void;
    vi.mocked(fetchDashboardSnapshot).mockReturnValue(
      new Promise((resolve) => {
        resolveSnapshot = resolve;
      }),
    );

    const queryClient = createQueryClient();
    render(
      <ThemeProvider>
        <QueryClientProvider client={queryClient}>
          <DetailPanel agentId={CODEX_AGENT_ID} onClose={vi.fn()} />
        </QueryClientProvider>
      </ThemeProvider>,
    );

    expect(await screen.findByLabelText("Loading agent")).toBeInTheDocument();

    resolveSnapshot(SNAPSHOT);
    await waitFor(() => {
      expect(screen.queryByLabelText("Loading agent")).not.toBeInTheDocument();
    });
  });

  it("AC: shows an empty state when the agent id is not present in the snapshot", async () => {
    renderPanel("does-not-exist");

    expect(await screen.findByText("Agent not found")).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Agent detail tabs" })).not.toBeInTheDocument();
  });
});

describe("DetailPanel tab switching", () => {
  it("AC: opens on the Overview tab by default and switches content when another tab is selected", async () => {
    const user = userEvent.setup();
    renderPanel(CODEX_AGENT_ID);
    await screen.findByRole("complementary", { name: "Agent details" });

    // TabList renders as a <nav> of plain buttons (aria-current, not the ARIA tabs widget).
    const tabs = screen.getByRole("navigation", { name: "Agent detail tabs" });
    expect(screen.getByRole("region", { name: "Agent detail content" })).toHaveAttribute("tabindex", "0");
    expect(tabs).toBeInTheDocument();
    // Overview content: the metadata list's 상태 row is only rendered by OverviewTab.
    expect(screen.getByText("Last signal")).toBeInTheDocument();

    await user.click(within(tabs).getByRole("button", { name: "Logs" }));
    await waitFor(() => {
      expect(screen.getByRole("log", { name: "Agent activity log" })).toBeInTheDocument();
    });

    await user.click(within(tabs).getByRole("button", { name: "Changes" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Refresh" })).toBeInTheDocument();
    });
    // ChangesTab fires view_diff on mount.
    await waitFor(() => {
      expect(postAgentAction).toHaveBeenCalled();
    });
  });

  it("AC: Changes describes view_diff as a point-in-time git status --short working-tree result", async () => {
    const user = userEvent.setup();
    renderPanel(CODEX_AGENT_ID);
    await screen.findByRole("complementary", { name: "Agent details" });

    const tabs = screen.getByRole("navigation", { name: "Agent detail tabs" });
    await user.click(within(tabs).getByRole("button", { name: "Changes" }));

    expect(await screen.findByText(/working tree output from git status --short/)).toHaveTextContent("point-in-time snapshot");
    expect(screen.queryByText(/git diff --stat/)).not.toBeInTheDocument();
  });
});

describe("DetailPanel disabled-action reasons", () => {
  it("AC: an agent with an observed runtime pid gets enabled process-signal actions", async () => {
    renderPanel(CODEX_AGENT_ID);
    await screen.findByRole("complementary", { name: "Agent details" });

    expect(screen.getByRole("button", { name: "Pause (SIGSTOP)" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Resume (SIGCONT)" })).toBeEnabled();
  });

  it("AC: a Claude-Code-sourced agent (never a runtime pid) renders process-signal actions disabled with a reason", async () => {
    renderPanel(CLAUDE_CODE_AGENT_ID);
    await screen.findByRole("complementary", { name: "Agent details" });

    const pauseButton = screen.getByRole("button", { name: "Pause (SIGSTOP)" });
    const resumeButton = screen.getByRole("button", { name: "Resume (SIGCONT)" });
    // Button uses aria-disabled (not native disabled) so the reason stays reachable via tooltip.
    expect(pauseButton).toHaveAttribute("aria-disabled", "true");
    expect(resumeButton).toHaveAttribute("aria-disabled", "true");

    // stop/pause/resume all share the same reason text (rendered once per tooltip), so assert presence rather than uniqueness.
    expect(screen.getAllByText("No running Codex process was found in the working directory.").length).toBeGreaterThan(0);
  });

  it("AC: retry/approve/reject always render disabled with the no-control-channel explanation", async () => {
    renderPanel(CODEX_AGENT_ID);
    await screen.findByRole("complementary", { name: "Agent details" });

    expect(screen.getByRole("button", { name: "Retry" })).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("button", { name: "Approve" })).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("button", { name: "Reject" })).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByText(/Retry, Approve, and Reject are always unavailable\./)).toBeInTheDocument();
  });
});

describe("DetailPanel stop confirmation", () => {
  it("AC: clicking Stop opens a confirmation dialog, and Cancel closes it without sending the action", async () => {
    const user = userEvent.setup();
    renderPanel(CODEX_AGENT_ID);
    await screen.findByRole("complementary", { name: "Agent details" });

    await user.click(screen.getByRole("button", { name: "Stop" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("Stop Migrate Codex Session Monitor?");

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => {
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    });
    expect(postAgentAction).not.toHaveBeenCalledWith(CODEX_AGENT_ID, { action: "stop" });
  });
});
