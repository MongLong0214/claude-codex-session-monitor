import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeProvider } from "@/components/providers/theme-provider";
import { buildMockSnapshot } from "@/data-access/mock-adapter";
import type { AgentId } from "@/domain/agent/agent";
import type { DashboardSnapshot } from "@/domain/dashboard";
import { dashboardKeys } from "@/lib/query/keys";
import { createQueryClient } from "@/lib/query/query-client";
import { OperationsTable } from "./operations-table";
import { useAgentTableState } from "./use-table-state";

vi.mock("@/lib/query/api", () => ({
  fetchDashboardSnapshot: vi.fn(),
  fetchAgentLogs: vi.fn(),
  postAgentAction: vi.fn(),
  postBulkAgentAction: vi.fn(),
}));

import { fetchDashboardSnapshot, postAgentAction, postBulkAgentAction } from "@/lib/query/api";
import { STOP_DIALOG_DESCRIPTION } from "../detail-panel/agent-actions";

/** Reuses the project's shared deterministic fixture (21 hand-written agents) instead of inventing new test data. */
const NOW_MS = Date.parse("2026-07-10T12:00:00.000Z");
const SNAPSHOT: DashboardSnapshot = buildMockSnapshot(NOW_MS);

function agentIdByDisplayName(displayName: string): AgentId {
  const found = Object.values(SNAPSHOT.byId).find((agent) => agent.displayName === displayName);
  if (!found) {
    throw new Error(`fixture agent not found: ${displayName}`);
  }
  return found.id;
}

const MONITOR_ID = agentIdByDisplayName("Migrate Codex Session Monitor");

/** `tableState` is owned by DashboardRoot in production (so the command palette can share it); a
 * thin harness stands in for that owner here, using the real hook with its no-persistence defaults. */
function TableHarness({ onOpenDetail }: { onOpenDetail: (agentId: AgentId) => void }) {
  const tableState = useAgentTableState();
  return <OperationsTable tableState={tableState} onOpenDetail={onOpenDetail} />;
}

function renderTable(onOpenDetail: (agentId: AgentId) => void = vi.fn()) {
  const queryClient = createQueryClient();
  queryClient.setQueryData(dashboardKeys.snapshot(), SNAPSHOT);

  const utils = render(
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <TableHarness onOpenDetail={onOpenDetail} />
      </QueryClientProvider>
    </ThemeProvider>,
  );

  return { ...utils, queryClient };
}

async function openRowStopDialog(user: ReturnType<typeof userEvent.setup>) {
  renderTable();
  await screen.findByRole("table", { name: "Agent operations table" });
  const trigger = screen.getByRole("button", { name: "Migrate Codex Session Monitor more actions" });
  await user.click(trigger);
  const menu = document.getElementById(trigger.getAttribute("aria-controls") ?? "");
  if (!menu) {
    throw new Error("row action menu not found");
  }
  await user.click(within(menu).getByRole("menuitem", { name: "Stop (SIGTERM)", hidden: true }));
  return screen.findByRole("alertdialog");
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(fetchDashboardSnapshot).mockResolvedValue(SNAPSHOT);
  vi.mocked(postAgentAction).mockResolvedValue({
    agentId: MONITOR_ID,
    action: "stop",
    status: "success",
    message: "Mock: stop completed",
  });
});

describe("OperationsTable search/filter", () => {
  it("AC: typing in the search box narrows visible rows to matches and updates the visible/total counter", async () => {
    const user = userEvent.setup();
    renderTable();

    const searchInput = await screen.findByRole("textbox", { name: "Search agents" });
    // ASCII substring unique to mock-pr-flavored's currentTask — avoids IME concerns with Korean typing.
    await user.type(searchInput, "pull/128");

    // The 200ms search debounce means the filter lands after typing; wait for the toolbar's own
    // "N / total" counter (proof the debounced filter has actually applied) before asserting on
    // row presence/absence, rather than racing an unrelated row that happens to render regardless.
    await waitFor(() => {
      expect(screen.getByText(`1 of ${SNAPSHOT.allIds.length} agents`)).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: "Await PR review details" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Rotate authentication token details" })).not.toBeInTheDocument();
  });

  it("AC: selecting a status in the toolbar's Status filter narrows rows the same way a status-counter click would", async () => {
    const user = userEvent.setup();
    renderTable();

    await screen.findByRole("table", { name: "Agent operations table" });

    const statusTrigger = screen.getByRole("combobox", { name: "Status" });
    await user.click(statusTrigger);
    const listbox = document.getElementById(statusTrigger.getAttribute("aria-controls") ?? "");
    if (!listbox) {
      throw new Error("Status listbox not found");
    }
    await user.click(within(listbox).getByRole("option", { name: "Failed", hidden: true }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Digest renderer details" })).toBeInTheDocument();
    });
    expect(screen.queryByRole("button", { name: "Await PR review details" })).not.toBeInTheDocument();
    expect(screen.getByText(`1 of ${SNAPSHOT.allIds.length} agents`)).toBeInTheDocument();
  });
});

describe("OperationsTable column visibility", () => {
  it("AC: toggling a column off in Columns hides it, toggling it back on restores it", async () => {
    const user = userEvent.setup();
    renderTable();

    await screen.findByRole("table", { name: "Agent operations table" });
    expect(screen.getByRole("columnheader", { name: "Current task" })).toBeInTheDocument();

    const columnsTrigger = screen.getByRole("combobox", { name: "Columns" });
    await user.click(columnsTrigger);
    const listbox = document.getElementById(columnsTrigger.getAttribute("aria-controls") ?? "");
    if (!listbox) {
      throw new Error("Columns listbox not found");
    }
    await user.click(within(listbox).getByRole("option", { name: "Current task", hidden: true }));

    await waitFor(() => {
      expect(screen.queryByRole("columnheader", { name: "Current task" })).not.toBeInTheDocument();
    });

    await user.click(columnsTrigger);
    await user.click(within(listbox).getByRole("option", { name: "Current task", hidden: true }));

    await waitFor(() => {
      expect(screen.getByRole("columnheader", { name: "Current task" })).toBeInTheDocument();
    });
  });
});

describe("OperationsTable row density", () => {
  it("AC: toggling density between Compact/Comfortable actually changes the rendered row height", async () => {
    const user = userEvent.setup();
    const { container } = renderTable();

    const table = await waitFor(() => {
      const el = container.querySelector("table");
      if (!el) {
        throw new Error("table not rendered yet");
      }
      return el;
    });

    // useAgentTableState defaults density to DEFAULT_DASHBOARD_SETTINGS.rowDensity ("compact" -> 34px).
    expect(table.style.getPropertyValue("--row-height")).toBe("34px");

    await user.click(screen.getByRole("radio", { name: "Comfortable" }));
    await waitFor(() => expect(table.style.getPropertyValue("--row-height")).toBe("40px"));

    await user.click(screen.getByRole("radio", { name: "Compact" }));
    await waitFor(() => expect(table.style.getPropertyValue("--row-height")).toBe("34px"));
  });
});

describe("OperationsTable bulk selection", () => {
  it("AC: checking a row's checkbox selects it and shows the bulk action bar only while a selection exists", async () => {
    const user = userEvent.setup();
    renderTable();

    await screen.findByRole("table", { name: "Agent operations table" });
    expect(screen.queryByRole("region", { name: "Bulk actions for selected agents" })).not.toBeInTheDocument();

    const rowCheckbox = screen.getByRole("checkbox", { name: "Select Migrate Codex Session Monitor" });
    await user.click(rowCheckbox);

    expect(screen.getByRole("region", { name: "Bulk actions for selected agents" })).toBeInTheDocument();
    expect(screen.getByText("1 selected")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Clear selection" }));
    expect(screen.queryByRole("region", { name: "Bulk actions for selected agents" })).not.toBeInTheDocument();
  });

  it("AC: a bulk action reports the success/failed/skipped breakdown from the response", async () => {
    const user = userEvent.setup();
    vi.mocked(postBulkAgentAction).mockResolvedValue({
      results: [{ agentId: MONITOR_ID, action: "pause", status: "success", message: "Mock: pause completed" }],
    });

    renderTable();
    await screen.findByRole("table", { name: "Agent operations table" });

    await user.click(screen.getByRole("checkbox", { name: "Select Migrate Codex Session Monitor" }));
    // Scoped to the bulk action bar: a running row's own quick-action cell also renders a
    // same-labelled "일시정지" button, so an unscoped query would be ambiguous.
    const bulkBar = screen.getByRole("region", { name: "Bulk actions for selected agents" });
    await user.click(within(bulkBar).getByRole("button", { name: "Pause" }));

    expect(await screen.findByText("1 succeeded · 0 failed · 0 skipped")).toBeInTheDocument();
    // react-query's mutationFn also receives a context object as a 2nd arg — only the request body is ours to assert.
    expect(vi.mocked(postBulkAgentAction).mock.calls[0]?.[0]).toEqual({ agentIds: [MONITOR_ID], action: "pause" });
  });

  it("AC: bulk stop waits for confirmation before posting", async () => {
    const user = userEvent.setup();
    vi.mocked(postBulkAgentAction).mockResolvedValue({
      results: [{ agentId: MONITOR_ID, action: "stop", status: "success", message: "Mock: stop completed" }],
    });

    renderTable();
    await screen.findByRole("table", { name: "Agent operations table" });
    await user.click(screen.getByRole("checkbox", { name: "Select Migrate Codex Session Monitor" }));

    const bulkBar = screen.getByRole("region", { name: "Bulk actions for selected agents" });
    await user.click(within(bulkBar).getByRole("button", { name: "Stop" }));

    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent(STOP_DIALOG_DESCRIPTION);
    expect(postBulkAgentAction).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole("button", { name: "Stop" }));
    await waitFor(() => expect(postBulkAgentAction).toHaveBeenCalledOnce());
    expect(vi.mocked(postBulkAgentAction).mock.calls[0]?.[0]).toEqual({ agentIds: [MONITOR_ID], action: "stop" });
  });
});

describe("OperationsTable row stop confirmation", () => {
  it("AC: cancelling row-menu stop closes the dialog without posting", async () => {
    const user = userEvent.setup();
    const dialog = await openRowStopDialog(user);
    expect(dialog).toHaveTextContent("Stop Migrate Codex Session Monitor");
    expect(dialog).toHaveTextContent(STOP_DIALOG_DESCRIPTION);
    expect(postAgentAction).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => {
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    });
    expect(postAgentAction).not.toHaveBeenCalledWith(MONITOR_ID, { action: "stop" });
  });

  it("AC: confirming row-menu stop posts the stop action", async () => {
    const user = userEvent.setup();
    const dialog = await openRowStopDialog(user);
    expect(postAgentAction).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole("button", { name: "Stop" }));
    await waitFor(() => {
      expect(postAgentAction).toHaveBeenCalledExactlyOnceWith(MONITOR_ID, { action: "stop" });
    });
  });
});

describe("OperationsTable keyboard navigation", () => {
  it("renders a sortable Agent header control", async () => {
    renderTable();
    await screen.findByRole("table", { name: "Agent operations table" });

    expect(screen.getByTitle("Agent")).toBeInTheDocument();
  });

  it("AC: ArrowDown moves roving focus to the next row, and Enter on the focused row opens its detail panel", async () => {
    const user = userEvent.setup();
    const onOpenDetail = vi.fn();
    // Narrow to exactly two rows (실패 + 차단됨) so ArrowDown from row 0 deterministically lands on row 1
    // regardless of the default sort order, without hard-coding which status sorts first.
    const failedId = agentIdByDisplayName("Digest renderer");
    const blockedId = agentIdByDisplayName("Resolve rebase conflicts");

    const { container } = renderTable(onOpenDetail);
    await screen.findByRole("table", { name: "Agent operations table" });

    const statusTrigger = screen.getByRole("combobox", { name: "Status" });
    await user.click(statusTrigger);
    const listbox = document.getElementById(statusTrigger.getAttribute("aria-controls") ?? "");
    if (!listbox) {
      throw new Error("Status listbox not found");
    }
    await user.click(within(listbox).getByRole("option", { name: "Failed", hidden: true }));
    await user.click(within(listbox).getByRole("option", { name: "Blocked", hidden: true }));
    await user.keyboard("{Escape}");

    const rows = await waitFor(() => {
      const found = container.querySelectorAll<HTMLTableRowElement>("tbody tr[data-row-index]");
      if (found.length !== 2) {
        throw new Error(`expected 2 filtered rows, found ${found.length}`);
      }
      return [...found];
    });
    const [firstRow, secondRow] = rows;
    if (!firstRow || !secondRow) {
      throw new Error("expected two rows");
    }

    firstRow.focus();
    expect(firstRow).toHaveFocus();

    await user.keyboard("{ArrowDown}");
    await waitFor(() => expect(secondRow).toHaveFocus());

    await user.keyboard("{Enter}");

    const secondRowId = within(secondRow).getByRole("button", { name: /details$/ }).getAttribute("aria-label") ===
      "Digest renderer details"
      ? failedId
      : blockedId;
    expect(onOpenDetail).toHaveBeenCalledExactlyOnceWith(secondRowId);
  });
});
