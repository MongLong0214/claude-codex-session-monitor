"use client";

import type {
  ColumnSizingState,
  OnChangeFn,
  RowSelectionState,
  SortingState,
  VisibilityState,
} from "@tanstack/react-table";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AgentStatusKind } from "@/domain/agent/status";
import type { DashboardSettings, RowDensity } from "@/domain/settings";
import { DEFAULT_DASHBOARD_SETTINGS } from "@/domain/settings";
import { DEFAULT_COLUMN_VISIBILITY } from "./columns";
import type { AgentTableFilters } from "./filter-sort";
import { visibleColumnsFromVisibilityState, type PersistedTableState } from "./settings-mapping";

/** Long enough to skip a burst of keystrokes, short enough that the table still feels live. */
const SEARCH_DEBOUNCE_MS = 200;

/** Column widths change on every frame of a resize drag; persist only the settled value. */
const COLUMN_SIZING_PERSIST_DEBOUNCE_MS = 200;

/** Elapsed-time cells re-derive from this; a minute is finer than the column's own resolution. */
const NOW_TICK_MS = 30_000;

function arePersistedSlicesEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) {
    return true;
  }
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((value, index) => arePersistedSlicesEqual(value, right[index]));
  }
  if (typeof left !== "object" || left === null || typeof right !== "object" || right === null) {
    return false;
  }

  const keys = Object.keys(left);
  return (
    keys.length === Object.keys(right).length &&
    keys.every(
      (key) => Object.hasOwn(right, key) && arePersistedSlicesEqual(Reflect.get(left, key), Reflect.get(right, key)),
    )
  );
}

/**
 * A ticking clock, hoisted so a virtualized row never owns an interval. The container re-renders
 * twice a minute and hands rows a new `nowMs`; a realtime event does not change it, so `memo()`
 * still blocks every row but the one whose agent actually changed.
 */
export function useNowMs(): number {
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const intervalId = window.setInterval(() => setNowMs(Date.now()), NOW_TICK_MS);
    return () => window.clearInterval(intervalId);
  }, []);

  return nowMs;
}

export interface AgentTableState {
  /** Debounced — this is what the filter predicate reads. */
  filters: AgentTableFilters;
  /** Undebounced — this is what the search input renders. */
  searchInput: string;
  setSearchInput: (search: string) => void;
  setStatusKinds: (statusKinds: AgentStatusKind[]) => void;
  setProjectCwds: (projectCwds: string[]) => void;
  setBranches: (branches: string[]) => void;
  resetFilters: () => void;
  hasActiveFilters: boolean;

  density: RowDensity;
  setDensity: (density: RowDensity) => void;

  sorting: SortingState;
  setSorting: OnChangeFn<SortingState>;
  columnVisibility: VisibilityState;
  setColumnVisibility: OnChangeFn<VisibilityState>;
  columnSizing: ColumnSizingState;
  setColumnSizing: OnChangeFn<ColumnSizingState>;
  rowSelection: RowSelectionState;
  setRowSelection: OnChangeFn<RowSelectionState>;
}

export interface UseAgentTableStateOptions {
  /**
   * Persisted values seed the state after hydration and reconcile later storage changes without
   * invoking `onPersist` again.
   */
  persistedState?: PersistedTableState;
  /**
   * Invoked whenever a persisted slice changes, with a patch already reshaped to DashboardSettings.
   * The search text and row selection are intentionally transient and never reach this callback.
   */
  onPersist?: (patch: Partial<DashboardSettings>) => void;
}

/**
 * All table-local state in one place. Every persisted slice mirrors its `domain/settings.ts`
 * counterpart (`rowDensity`, `visibleColumns`, `columnWidths`, `sort`, and the three filter
 * arrays); `persistedState` hydrates and reconciles them, and each setter pushes user changes out
 * through `onPersist`. Column widths persist on a debounce because their setter fires on every
 * frame of a resize drag; every other slice persists on its discrete user action.
 */
export function useAgentTableState(options: UseAgentTableStateOptions = {}): AgentTableState {
  const { persistedState, onPersist } = options;

  // Kept in a ref so the wrapped setters stay referentially stable (react-table compares them).
  const onPersistRef = useRef(onPersist);
  useEffect(() => {
    onPersistRef.current = onPersist;
  });

  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [statusKinds, setStatusKindsState] = useState<AgentStatusKind[]>(persistedState?.statusKinds ?? []);
  const [projectCwds, setProjectCwdsState] = useState<string[]>(persistedState?.projectCwds ?? []);
  const [branches, setBranchesState] = useState<string[]>(persistedState?.branches ?? []);

  const [density, setDensityState] = useState<RowDensity>(
    persistedState?.density ?? DEFAULT_DASHBOARD_SETTINGS.rowDensity,
  );
  const [sorting, setSortingState] = useState<SortingState>(persistedState?.sorting ?? []);
  const [columnVisibility, setColumnVisibilityState] = useState<VisibilityState>(
    persistedState?.columnVisibility ?? DEFAULT_COLUMN_VISIBILITY,
  );
  const [columnSizing, setColumnSizingState] = useState<ColumnSizingState>(persistedState?.columnSizing ?? {});
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});

  const [externallySyncedColumnSizing, setExternallySyncedColumnSizing] = useState<ColumnSizingState | null>(null);
  const [lastPersistedState, setLastPersistedState] = useState(persistedState);
  if (persistedState !== lastPersistedState) {
    const previous = lastPersistedState;
    setLastPersistedState(persistedState);
    if (persistedState) {
      if (!previous || previous.density !== persistedState.density) {
        setDensityState(persistedState.density);
      }
      if (!previous || !arePersistedSlicesEqual(previous.statusKinds, persistedState.statusKinds)) {
        setStatusKindsState(persistedState.statusKinds);
      }
      if (!previous || !arePersistedSlicesEqual(previous.projectCwds, persistedState.projectCwds)) {
        setProjectCwdsState(persistedState.projectCwds);
      }
      if (!previous || !arePersistedSlicesEqual(previous.branches, persistedState.branches)) {
        setBranchesState(persistedState.branches);
      }
      if (!previous || !arePersistedSlicesEqual(previous.sorting, persistedState.sorting)) {
        setSortingState(persistedState.sorting);
      }
      if (!previous || !arePersistedSlicesEqual(previous.columnVisibility, persistedState.columnVisibility)) {
        setColumnVisibilityState(persistedState.columnVisibility);
      }
      if (!previous || !arePersistedSlicesEqual(previous.columnSizing, persistedState.columnSizing)) {
        setExternallySyncedColumnSizing(persistedState.columnSizing);
        if (!arePersistedSlicesEqual(columnSizing, persistedState.columnSizing)) {
          setColumnSizingState(persistedState.columnSizing);
        }
      }
    }
  }

  useEffect(() => {
    const timeoutId = window.setTimeout(() => setSearch(searchInput), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timeoutId);
  }, [searchInput]);

  const externalColumnSizingEchoRef = useRef<ColumnSizingState | null>(null);
  useEffect(() => {
    externalColumnSizingEchoRef.current = externallySyncedColumnSizing;
  }, [externallySyncedColumnSizing]);

  // Skips the mount pass (the seeded value is already persisted) so a plain page load never writes.
  const hasColumnSizingSettledRef = useRef(false);
  useEffect(() => {
    if (!hasColumnSizingSettledRef.current) {
      hasColumnSizingSettledRef.current = true;
      return;
    }
    if (
      externalColumnSizingEchoRef.current !== null &&
      arePersistedSlicesEqual(externalColumnSizingEchoRef.current, columnSizing)
    ) {
      externalColumnSizingEchoRef.current = null;
      return;
    }
    externalColumnSizingEchoRef.current = null;
    const timeoutId = window.setTimeout(
      () => onPersistRef.current?.({ columnWidths: columnSizing }),
      COLUMN_SIZING_PERSIST_DEBOUNCE_MS,
    );
    return () => window.clearTimeout(timeoutId);
  }, [columnSizing, externallySyncedColumnSizing]);

  const setStatusKinds = useCallback((next: AgentStatusKind[]) => {
    setStatusKindsState(next);
    onPersistRef.current?.({ statusFilter: next });
  }, []);

  const setProjectCwds = useCallback((next: string[]) => {
    setProjectCwdsState(next);
    onPersistRef.current?.({ projectFilter: next });
  }, []);

  const setBranches = useCallback((next: string[]) => {
    setBranchesState(next);
    onPersistRef.current?.({ branchFilter: next });
  }, []);

  const setDensity = useCallback((next: RowDensity) => {
    setDensityState(next);
    onPersistRef.current?.({ rowDensity: next });
  }, []);

  const setSorting = useCallback<OnChangeFn<SortingState>>((updater) => {
    setSortingState((previous) => {
      const next = typeof updater === "function" ? updater(previous) : updater;
      onPersistRef.current?.({ sort: next });
      return next;
    });
  }, []);

  const setColumnVisibility = useCallback<OnChangeFn<VisibilityState>>((updater) => {
    setColumnVisibilityState((previous) => {
      const next = typeof updater === "function" ? updater(previous) : updater;
      onPersistRef.current?.({ visibleColumns: visibleColumnsFromVisibilityState(next) });
      return next;
    });
  }, []);

  const filters = useMemo<AgentTableFilters>(
    () => ({ search, statusKinds, projectCwds, branches }),
    [search, statusKinds, projectCwds, branches],
  );

  const resetFilters = useCallback(() => {
    setSearchInput("");
    setSearch("");
    setStatusKindsState([]);
    setProjectCwdsState([]);
    setBranchesState([]);
    onPersistRef.current?.({ statusFilter: [], projectFilter: [], branchFilter: [] });
  }, []);

  const hasActiveFilters =
    searchInput !== "" || statusKinds.length > 0 || projectCwds.length > 0 || branches.length > 0;

  return {
    filters,
    searchInput,
    setSearchInput,
    setStatusKinds,
    setProjectCwds,
    setBranches,
    resetFilters,
    hasActiveFilters,
    density,
    setDensity,
    sorting,
    setSorting,
    columnVisibility,
    setColumnVisibility,
    columnSizing,
    setColumnSizing: setColumnSizingState,
    rowSelection,
    setRowSelection,
  };
}
