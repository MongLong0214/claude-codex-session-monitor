import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildMockSnapshot } from "@/data-access/mock-adapter";
import type { AgentStatusKind } from "@/domain/agent/status";
import { DEFAULT_DASHBOARD_SETTINGS, type DashboardSettings } from "@/domain/settings";
import { dashboardKeys } from "@/lib/query/keys";
import { DashboardRoot } from "./dashboard-root";
import type { DashboardView } from "./shell/side-nav";

vi.mock("@/lib/query/api", () => ({
  fetchDashboardSnapshot: vi.fn(),
}));

vi.mock("@/lib/query/use-realtime-sync", () => ({
  useRealtimeSync: () => ({ status: "open", lastEventAt: null }),
}));

vi.mock("./dashboard-workspace", () => ({
  DashboardWorkspace: () => (
    <>
      <input aria-label="mock search" data-search-input-id="agent-table-search-input" />
      <p>workspace</p>
    </>
  ),
}));

vi.mock("./shell/dashboard-app-shell", () => ({
  DashboardAppShell: ({
    children,
    statusFilter,
    onToggleStatusFilter,
    onSelectProject,
    onSelectAll,
    onSelectIncidents,
    selectedView,
  }: {
    children: ReactNode;
    statusFilter: AgentStatusKind[];
    onToggleStatusFilter: (status: AgentStatusKind) => void;
    onSelectProject: (cwd: string) => void;
    onSelectAll: () => void;
    onSelectIncidents: () => void;
    selectedView: DashboardView;
  }) => (
    <main>
      <button
        type="button"
        aria-pressed={statusFilter.includes("failed")}
        onClick={() => onToggleStatusFilter("failed")}
      >
        failed counter
      </button>
      <button type="button" onClick={() => onSelectProject("/repo/selected")}>
        selected project
      </button>
      <button type="button" onClick={onSelectAll}>
        all agents
      </button>
      <button type="button" onClick={onSelectIncidents}>
        incidents
      </button>
      <output data-testid="selected-view">
        {typeof selectedView === "object" ? selectedView.projectCwd : selectedView}
      </output>
      {children}
    </main>
  ),
}));

import { fetchDashboardSnapshot } from "@/lib/query/api";

const SNAPSHOT = buildMockSnapshot(Date.parse("2026-07-10T12:00:00.000Z"));

function renderRoot(settings: DashboardSettings, onUpdateSettings = vi.fn(), hasSnapshot = true) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 0 } },
  });
  if (hasSnapshot) {
    queryClient.setQueryData(dashboardKeys.snapshot(), SNAPSHOT);
  }

  return {
    ...render(
      <QueryClientProvider client={queryClient}>
        <DashboardRoot settings={settings} onUpdateSettings={onUpdateSettings} />
      </QueryClientProvider>,
    ),
    onUpdateSettings,
    queryClient,
  };
}

beforeEach(() => {
  vi.mocked(fetchDashboardSnapshot).mockReset();
  vi.mocked(fetchDashboardSnapshot).mockResolvedValue(SNAPSHOT);
});

describe("DashboardRoot initial snapshot state", () => {
  it("renders a failed initial snapshot as an error instead of a no-data spinner", async () => {
    // Given: the first snapshot request fails before producing data.
    vi.mocked(fetchDashboardSnapshot).mockRejectedValue(new Error("snapshot unavailable"));

    // When: the dashboard root observes the failed request.
    renderRoot(DEFAULT_DASHBOARD_SETTINGS, vi.fn(), false);

    // Then: the failure is visible rather than masked by the no-data loading branch.
    expect(await screen.findByText(/snapshot unavailable/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Loading dashboard")).not.toBeInTheDocument();
  });

  it("keeps cached dashboard data visible when a background refetch fails", async () => {
    // Given: cached dashboard data exists before a refetch failure.
    vi.mocked(fetchDashboardSnapshot).mockRejectedValue(new Error("snapshot refresh failed"));

    // When: the mounted query records the background failure.
    const { queryClient } = renderRoot(DEFAULT_DASHBOARD_SETTINGS);
    await waitFor(() => {
      expect(queryClient.getQueryState(dashboardKeys.snapshot())?.status).toBe("error");
    });

    // Then: cached content remains visible and the fatal error does not replace it.
    expect(screen.getByText("workspace")).toBeInTheDocument();
    expect(screen.queryByText(/snapshot refresh failed/)).not.toBeInTheDocument();
  });
});

describe("DashboardRoot persisted shell filters", () => {
  it("uses and updates the persisted status filter for the top counter", async () => {
    // Given: failed is already active in persisted/table settings.
    const user = userEvent.setup();
    const { onUpdateSettings } = renderRoot({ ...DEFAULT_DASHBOARD_SETTINGS, statusFilter: ["failed"] });

    // When: the user toggles the failed counter.
    const failedCounter = screen.getByRole("button", { name: "failed counter" });
    expect(failedCounter).toHaveAttribute("aria-pressed", "true");
    await user.click(failedCounter);

    // Then: the shared persisted filter is cleared.
    expect(onUpdateSettings).toHaveBeenCalledExactlyOnceWith({ statusFilter: [] });
  });

  it("applies project navigation to the persisted table filter and All clears it", async () => {
    // Given: a dashboard with the side-nav callbacks mounted.
    const user = userEvent.setup();
    const { onUpdateSettings } = renderRoot(DEFAULT_DASHBOARD_SETTINGS);

    // When: the user selects a project and then All Agents.
    await user.click(screen.getByRole("button", { name: "selected project" }));
    await user.click(screen.getByRole("button", { name: "all agents" }));

    // Then: the table receives the selected cwd followed by an empty filter.
    expect(onUpdateSettings).toHaveBeenNthCalledWith(1, { projectFilter: ["/repo/selected"] });
    expect(onUpdateSettings).toHaveBeenNthCalledWith(2, { projectFilter: [] });
  });

  it("initializes side-nav selection from the persisted project filter", () => {
    // Given / When: the dashboard mounts with a persisted project filter.
    renderRoot({ ...DEFAULT_DASHBOARD_SETTINGS, projectFilter: ["/repo/persisted"] });

    // Then: the matching project view is selected immediately.
    expect(screen.getByTestId("selected-view")).toHaveTextContent("/repo/persisted");
  });

  it("reconciles cross-tab project filters without writing them back", () => {
    // Given: the dashboard is showing All without a project filter.
    const onUpdateSettings = vi.fn();
    const { queryClient, rerender } = renderRoot(DEFAULT_DASHBOARD_SETTINGS, onUpdateSettings);

    // When: persisted settings arrive from another tab.
    rerender(
      <QueryClientProvider client={queryClient}>
        <DashboardRoot
          settings={{ ...DEFAULT_DASHBOARD_SETTINGS, projectFilter: ["/repo/cross-tab"] }}
          onUpdateSettings={onUpdateSettings}
        />
      </QueryClientProvider>,
    );

    // Then: selection follows the persisted filter without a persistence echo.
    expect(screen.getByTestId("selected-view")).toHaveTextContent("/repo/cross-tab");
    expect(onUpdateSettings).not.toHaveBeenCalled();
  });
});

describe("DashboardRoot keyboard shortcuts", () => {
  it("focuses the agent search input when slash is pressed outside an editable control", async () => {
    const user = userEvent.setup();
    renderRoot(DEFAULT_DASHBOARD_SETTINGS);

    await user.keyboard("/");

    expect(screen.getByRole("textbox", { name: "mock search" })).toHaveFocus();
  });
});
