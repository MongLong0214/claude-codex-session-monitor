import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_VISIBLE_COLUMNS } from "@/domain/settings";
import { tableStateFromSettings } from "./settings-mapping";
import { useAgentTableState } from "./use-table-state";

afterEach(() => {
  vi.useRealTimers();
});

describe("useAgentTableState persisted-state reconciliation", () => {
  it("reconciles every persisted table slice without writing it back", () => {
    // Given: a mounted table seeded from the default persisted settings.
    vi.useFakeTimers();
    const onPersist = vi.fn();
    const initialState = tableStateFromSettings({
      schemaVersion: 1,
      theme: "system",
      sidebarCollapsed: false,
      rowDensity: "compact",
      visibleColumns: [...DEFAULT_VISIBLE_COLUMNS],
      columnWidths: {},
      statusFilter: [],
      projectFilter: [],
      branchFilter: [],
      sort: [],
    });
    const externalState = tableStateFromSettings({
      schemaVersion: 1,
      theme: "system",
      sidebarCollapsed: false,
      rowDensity: "comfortable",
      visibleColumns: DEFAULT_VISIBLE_COLUMNS.filter((columnId) => columnId !== "currentTask"),
      columnWidths: { agent: 420 },
      statusFilter: ["failed"],
      projectFilter: ["/repo/external"],
      branchFilter: ["main"],
      sort: [{ id: "status", desc: true }],
    });
    const { result, rerender } = renderHook(({ persistedState }) => useAgentTableState({ persistedState, onPersist }), {
      initialProps: { persistedState: initialState },
    });

    // When: another tab replaces the persisted table settings.
    rerender({ persistedState: externalState });
    act(() => {
      vi.advanceTimersByTime(201);
    });

    // Then: all local slices reconcile, and the external width does not bounce back to storage.
    expect(result.current.density).toBe("comfortable");
    expect(result.current.filters.statusKinds).toEqual(["failed"]);
    expect(result.current.filters.projectCwds).toEqual(["/repo/external"]);
    expect(result.current.filters.branches).toEqual(["main"]);
    expect(result.current.sorting).toEqual([{ id: "status", desc: true }]);
    expect(result.current.columnVisibility.currentTask).toBe(false);
    expect(result.current.columnSizing).toEqual({ agent: 420 });
    expect(onPersist).not.toHaveBeenCalled();
  });

  it("still debounces a local column resize into one persisted patch", () => {
    // Given: a mounted table and a persistence observer.
    vi.useFakeTimers();
    const onPersist = vi.fn();
    const { result } = renderHook(() => useAgentTableState({ onPersist }));

    // When: the user resizes the same column twice before the debounce settles.
    act(() => {
      result.current.setColumnSizing({ agent: 300 });
      result.current.setColumnSizing({ agent: 320 });
    });
    act(() => {
      vi.advanceTimersByTime(201);
    });

    // Then: only the settled width persists.
    expect(onPersist).toHaveBeenCalledExactlyOnceWith({ columnWidths: { agent: 320 } });
  });

  it("keeps a pending resize when an unrelated persisted setting changes", () => {
    // Given: a resize is waiting for the persistence debounce.
    vi.useFakeTimers();
    const onPersist = vi.fn();
    const initialState = tableStateFromSettings({
      schemaVersion: 1,
      theme: "system",
      sidebarCollapsed: false,
      rowDensity: "compact",
      visibleColumns: [...DEFAULT_VISIBLE_COLUMNS],
      columnWidths: { agent: 240, status: 116 },
      statusFilter: [],
      projectFilter: [],
      branchFilter: [],
      sort: [],
    });
    const { result, rerender } = renderHook(({ persistedState }) => useAgentTableState({ persistedState, onPersist }), {
      initialProps: { persistedState: initialState },
    });
    act(() => {
      result.current.setColumnSizing({ agent: 320, status: 116 });
    });

    // When: a theme update supplies a new settings object with unchanged table slices.
    rerender({
      persistedState: tableStateFromSettings({
        schemaVersion: 1,
        theme: "dark",
        sidebarCollapsed: false,
        rowDensity: "compact",
        visibleColumns: [...DEFAULT_VISIBLE_COLUMNS],
        columnWidths: { status: 116, agent: 240 },
        statusFilter: [],
        projectFilter: [],
        branchFilter: [],
        sort: [],
      }),
    });
    act(() => {
      vi.advanceTimersByTime(201);
    });

    // Then: the local width remains and settles through the original debounce.
    expect(result.current.columnSizing).toEqual({ agent: 320, status: 116 });
    expect(onPersist).toHaveBeenCalledExactlyOnceWith({ columnWidths: { agent: 320, status: 116 } });
  });

  it("persists a local resize back to a previously reconciled external width", () => {
    // Given: an external width has reconciled once without bouncing back to persistence.
    vi.useFakeTimers();
    const onPersist = vi.fn();
    const initialState = tableStateFromSettings({
      schemaVersion: 1,
      theme: "system",
      sidebarCollapsed: false,
      rowDensity: "compact",
      visibleColumns: [...DEFAULT_VISIBLE_COLUMNS],
      columnWidths: { agent: 240 },
      statusFilter: [],
      projectFilter: [],
      branchFilter: [],
      sort: [],
    });
    const externalState = { ...initialState, columnSizing: { agent: 420 } };
    const { result, rerender } = renderHook(({ persistedState }) => useAgentTableState({ persistedState, onPersist }), {
      initialProps: { persistedState: initialState },
    });
    rerender({ persistedState: externalState });
    act(() => {
      vi.advanceTimersByTime(201);
    });
    expect(onPersist).not.toHaveBeenCalled();

    // When: local resizes persist Y and then return exactly to the old external X.
    act(() => {
      result.current.setColumnSizing({ agent: 500 });
    });
    act(() => {
      vi.advanceTimersByTime(201);
    });
    act(() => {
      result.current.setColumnSizing({ agent: 420 });
    });
    act(() => {
      vi.advanceTimersByTime(201);
    });

    // Then: both local actions persist; the external echo suppresses only its reconciliation.
    expect(onPersist).toHaveBeenNthCalledWith(1, { columnWidths: { agent: 500 } });
    expect(onPersist).toHaveBeenNthCalledWith(2, { columnWidths: { agent: 420 } });
  });
});
