"use client";

import { useImperativeAlertDialog } from "@astryxdesign/core/AlertDialog";
import { Button } from "@astryxdesign/core/Button";
import { Center } from "@astryxdesign/core/Center";
import { CheckboxInput } from "@astryxdesign/core/CheckboxInput";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Icon } from "@astryxdesign/core/Icon";
import { VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { useToast } from "@astryxdesign/core/Toast";
import { getCoreRowModel, useReactTable, type Header } from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import type { AgentActionType } from "@/domain/agent/actions";
import type { AgentId, ProjectRef } from "@/domain/agent/agent";
import { useAgentAction, useBulkAgentAction, type OptimisticStatus } from "@/lib/query/use-agent-action";
import { useDashboardSnapshot } from "@/lib/query/use-dashboard-snapshot";
import { STOP_DIALOG_DESCRIPTION } from "../detail-panel/agent-actions";
import { AgentTableRow } from "./agent-table-row";
import { BulkActionBar } from "./bulk-action-bar";
import {
  agentTableColumns,
  buildColumnLayout,
  getTableWidth,
  ROW_HEIGHT_PX,
  type ColumnLayout,
} from "./columns";
import { deriveBranchOptions, selectVisibleAgentIds } from "./filter-sort";
import styles from "./operations-table.module.css";
import { TableToolbar } from "./table-toolbar";
import { useNowMs, type AgentTableState } from "./use-table-state";

/** Module-level so an empty snapshot doesn't hand the virtualizer a fresh array every render. */
const EMPTY_AGENT_IDS: AgentId[] = [];
const EMPTY_PROJECTS: ProjectRef[] = [];

const ROW_OVERSCAN = 8;

/**
 * Only pause/resume are safe to predict: the local adapter can genuinely signal a live process.
 * `stop` gets no optimistic patch (its outcome is not predictable), and retry/approve/reject are
 * answered with "skipped" by the local adapter — patching them would render a lie for one frame.
 */
const OPTIMISTIC_STATUS_BY_ACTION: Partial<Record<AgentActionType, OptimisticStatus>> = {
  pause: () => ({ kind: "paused", pausedAt: new Date().toISOString() }),
  resume: (current) => ({
    kind: "running",
    startedAt: current.startedAt,
    lastHeartbeatAt: new Date().toISOString(),
  }),
};

function headerCellStyle(column: ColumnLayout): CSSProperties {
  const style: CSSProperties = { width: column.size };
  if (column.stickyLeft !== null) {
    style.left = column.stickyLeft;
  }
  return style;
}

function headerCellClassName(column: ColumnLayout): string {
  const classNames = [styles.th];
  if (column.stickyLeft !== null) {
    classNames.push(styles.thSticky);
  }
  if (column.isEndAligned) {
    classNames.push(styles.tdEnd);
  }
  return classNames.join(" ");
}

function ariaSortOf(header: Header<AgentId, unknown> | undefined): "ascending" | "descending" | "none" | undefined {
  if (!header?.column.getCanSort()) {
    return undefined;
  }
  const sorted = header.column.getIsSorted();
  if (sorted === "asc") {
    return "ascending";
  }
  if (sorted === "desc") {
    return "descending";
  }
  return "none";
}

function sortIconOf(header: Header<AgentId, unknown>) {
  const sorted = header.column.getIsSorted();
  if (sorted === "asc") {
    return <Icon icon="arrowUp" size="xsm" color="accent" />;
  }
  if (sorted === "desc") {
    return <Icon icon="arrowDown" size="xsm" color="accent" />;
  }
  return <Icon icon="arrowsUpDown" size="xsm" color="disabled" />;
}

export interface OperationsTableProps {
  /**
   * Owned by DashboardRoot so the command palette can share the same filter/density setters.
   * The table only reads and drives it; it does not create it.
   */
  tableState: AgentTableState;
  onOpenDetail: (agentId: AgentId) => void;
}

/**
 * `useToast()` needs a ToastContext. A single shared `ToastViewport` is mounted once in
 * `dashboard-root.tsx` (above this component and the command palette, which also calls
 * `useToast()`) — mounting one here too would put two `role="region" aria-label="Notifications"`
 * landmarks on the page at once, which is a real axe-core `landmark-unique` violation, not just a
 * style nit. The nearest provider wins, so this component only needs the hook, never its own viewport.
 */
export function OperationsTable({ tableState, onOpenDetail }: OperationsTableProps) {
  return <OperationsTableContent tableState={tableState} onOpenDetail={onOpenDetail} />;
}

function OperationsTableContent({ tableState, onOpenDetail }: OperationsTableProps) {
  const { data } = useDashboardSnapshot();
  const nowMs = useNowMs();
  const showToast = useToast();
  const { mutate: runAgentAction } = useAgentAction();
  const { mutate: runBulkAgentAction, isPending: isBulkActionPending } = useBulkAgentAction();
  const { element: stopDialog, hide: hideStopDialog, show: showStopDialog } = useImperativeAlertDialog();

  const scrollElementRef = useRef<HTMLElement>(null);
  const dataRef = useRef(data);
  const [focusedRowIndex, setFocusedRowIndex] = useState(0);
  const isFocusPendingRef = useRef(false);

  useEffect(() => {
    dataRef.current = data;
  }, [data]);

  const { columnSizing, columnVisibility, density, filters, rowSelection, setRowSelection, sorting } = tableState;

  const visibleAgentIds = useMemo(
    () => (data ? selectVisibleAgentIds(data, filters, sorting) : EMPTY_AGENT_IDS),
    [data, filters, sorting],
  );
  const branchOptions = useMemo(() => (data ? deriveBranchOptions(data) : []), [data]);

  // Stable across realtime events (both slices are unchanged objects unless the user edits them),
  // so memo()'d rows keep their identity check even while the container re-renders.
  const columnLayout = useMemo(() => buildColumnLayout(columnVisibility, columnSizing), [columnVisibility, columnSizing]);

  // TanStack Table returns non-memoizable functions; React Compiler safely skips this hook.
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable<AgentId>({
    data: visibleAgentIds,
    columns: agentTableColumns,
    getRowId: (agentId) => agentId,
    getCoreRowModel: getCoreRowModel(),
    // Filtering and sorting already happened in selectVisibleAgentIds, against the full snapshot.
    manualFiltering: true,
    manualSorting: true,
    enableColumnResizing: true,
    columnResizeMode: "onChange",
    enableRowSelection: true,
    state: { columnSizing, columnVisibility, rowSelection, sorting },
    onColumnSizingChange: tableState.setColumnSizing,
    onColumnVisibilityChange: tableState.setColumnVisibility,
    onRowSelectionChange: setRowSelection,
    onSortingChange: tableState.setSorting,
  });

  const rowHeight = ROW_HEIGHT_PX[density];
  const virtualizer = useVirtualizer<HTMLElement, HTMLTableRowElement>({
    count: visibleAgentIds.length,
    getScrollElement: () => scrollElementRef.current,
    // Rows are a fixed height, so this is exact rather than an estimate — no measurement pass.
    estimateSize: () => rowHeight,
    getItemKey: (index) => visibleAgentIds[index] ?? index,
    overscan: ROW_OVERSCAN,
  });

  useEffect(() => {
    virtualizer.measure();
  }, [virtualizer, rowHeight]);

  // The parent owns `onOpenDetail` and may recreate it each render; a latest-ref keeps the
  // callback handed to every row referentially stable, which is what memo() compares on.
  const onOpenDetailRef = useRef(onOpenDetail);
  useEffect(() => {
    onOpenDetailRef.current = onOpenDetail;
  });
  const handleOpenDetail = useCallback((agentId: AgentId) => onOpenDetailRef.current(agentId), []);

  const handleToggleSelected = useCallback(
    (agentId: AgentId) => {
      setRowSelection((previous) => {
        if (previous[agentId] === true) {
          const { [agentId]: _removed, ...rest } = previous;
          return rest;
        }
        return { ...previous, [agentId]: true };
      });
    },
    [setRowSelection],
  );

  const executeRowAction = useCallback(
    (agentId: AgentId, action: AgentActionType) => {
      const optimisticStatus = OPTIMISTIC_STATUS_BY_ACTION[action];
      runAgentAction(
        optimisticStatus ? { agentId, request: { action }, optimisticStatus } : { agentId, request: { action } },
        {
          // The local adapter answers retry/approve/reject with "skipped" and an explanation.
          // Surfacing `result.message` verbatim is the honest outcome, not a fabricated success.
          onSuccess: (result) =>
            showToast({
              body: result.message,
              type: result.status === "failed" ? "error" : "info",
              uniqueID: `${result.agentId}:${result.action}`,
            }),
          onError: (error) => showToast({ body: `Could not run action: ${error.message}`, type: "error" }),
        },
      );
    },
    [runAgentAction, showToast],
  );

  const requestStopConfirmation = useCallback(
    (title: string, onConfirm: () => void) => {
      showStopDialog({
        title,
        description: STOP_DIALOG_DESCRIPTION,
        actionLabel: "Stop",
        cancelLabel: "Cancel",
        actionVariant: "destructive",
        onAction: () => {
          hideStopDialog();
          onConfirm();
        },
      });
    },
    [hideStopDialog, showStopDialog],
  );

  const handleRowAction = useCallback(
    (agentId: AgentId, action: AgentActionType) => {
      if (action !== "stop") {
        executeRowAction(agentId, action);
        return;
      }

      requestStopConfirmation(`Stop ${dataRef.current?.byId[agentId]?.displayName ?? "agent"}`, () =>
        executeRowAction(agentId, "stop"),
      );
    },
    [executeRowAction, requestStopConfirmation],
  );

  const moveFocus = useCallback(
    (nextRowIndex: number) => {
      if (visibleAgentIds.length === 0) {
        return;
      }
      const clamped = Math.max(0, Math.min(nextRowIndex, visibleAgentIds.length - 1));
      isFocusPendingRef.current = true;
      virtualizer.scrollToIndex(clamped);
      setFocusedRowIndex(clamped);
    },
    [virtualizer, visibleAgentIds.length],
  );

  /**
   * Native table semantics plus a roving tabindex — not an ARIA grid, which this table does not
   * implement well enough to claim. Row-level keys only fire when the row itself has focus, so a
   * Space press inside the checkbox or a Enter press on the name button is never hijacked.
   */
  const handleRowKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTableRowElement>, rowIndex: number) => {
      if (event.target !== event.currentTarget) {
        return;
      }

      if (event.key === "ArrowDown") {
        event.preventDefault();
        moveFocus(rowIndex + 1);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        moveFocus(rowIndex - 1);
      } else if (event.key === "Home") {
        event.preventDefault();
        moveFocus(0);
      } else if (event.key === "End") {
        event.preventDefault();
        moveFocus(visibleAgentIds.length - 1);
      } else if (event.key === "Enter") {
        event.preventDefault();
        const agentId = visibleAgentIds[rowIndex];
        if (agentId !== undefined) {
          handleOpenDetail(agentId);
        }
      } else if (event.key === " ") {
        event.preventDefault();
        const agentId = visibleAgentIds[rowIndex];
        if (agentId !== undefined) {
          handleToggleSelected(agentId);
        }
      }
    },
    [handleOpenDetail, handleToggleSelected, moveFocus, visibleAgentIds],
  );

  /**
   * Runs after every render on purpose: `scrollToIndex` may need a scroll + re-render before the
   * target row is mounted at all, so the focus attempt has to be retried until the row exists.
   */
  useEffect(() => {
    if (!isFocusPendingRef.current) {
      return;
    }
    const row = scrollElementRef.current?.querySelector<HTMLTableRowElement>(
      `tr[data-row-index="${focusedRowIndex}"]`,
    );
    if (row) {
      isFocusPendingRef.current = false;
      row.focus();
    }
  });

  const selectedAgentIds = table.getSelectedRowModel().rows.map((row) => row.original);

  const executeBulkAction = useCallback(
    (agentIds: AgentId[], action: AgentActionType) => {
      runBulkAgentAction(
        { agentIds, action },
        {
          onSuccess: ({ results }) => {
            const succeeded = results.filter((result) => result.status === "success").length;
            const failed = results.filter((result) => result.status === "failed").length;
            const skipped = results.filter((result) => result.status === "skipped").length;
            showToast({
              body: `${succeeded} succeeded · ${failed} failed · ${skipped} skipped`,
              type: failed > 0 ? "error" : "info",
            });
          },
          onError: (error) => showToast({ body: `Bulk action failed: ${error.message}`, type: "error" }),
        },
      );
    },
    [runBulkAgentAction, showToast],
  );

  const handleBulkAction = useCallback(
    (action: AgentActionType) => {
      if (selectedAgentIds.length === 0) {
        return;
      }
      if (action !== "stop") {
        executeBulkAction(selectedAgentIds, action);
        return;
      }

      requestStopConfirmation(`Stop ${selectedAgentIds.length} selected agents`, () =>
        executeBulkAction(selectedAgentIds, "stop"),
      );
    },
    [executeBulkAction, requestStopConfirmation, selectedAgentIds],
  );

  if (!data) {
    return null;
  }

  const headersById = new Map(table.getFlatHeaders().map((header) => [header.column.id, header]));
  const virtualRows = virtualizer.getVirtualItems();
  // Out of range while the filtered list is shorter than the last focused index: no row is
  // tabbable, which is correct — there is nothing to focus.
  const activeRowIndex = visibleAgentIds.length === 0 ? -1 : Math.min(focusedRowIndex, visibleAgentIds.length - 1);

  return (
    <VStack className={styles.root} gap={0}>
      <TableToolbar
        tableState={tableState}
        projects={data.projects ?? EMPTY_PROJECTS}
        branches={branchOptions}
        visibleRowCount={visibleAgentIds.length}
        totalRowCount={data.allIds.length}
      />

      {selectedAgentIds.length > 0 ? (
        <BulkActionBar
          selectedCount={selectedAgentIds.length}
          isPending={isBulkActionPending}
          onAction={handleBulkAction}
          onClearSelection={() => table.resetRowSelection()}
        />
      ) : null}

      {visibleAgentIds.length === 0 ? (
        <Center height="100%" className={styles.emptyRegion}>
          <EmptyState
            title={tableState.hasActiveFilters ? "No matching agents" : "No sessions detected"}
            description={
              tableState.hasActiveFilters
                ? "No agents match the current filters. Clear them to restore the full session list."
                : "Start a Codex or Claude Code session and it will appear here automatically."
            }
            icon={<Icon icon={tableState.hasActiveFilters ? "search" : "viewColumns"} size="lg" color="disabled" />}
            actions={
              tableState.hasActiveFilters ? (
                <Button label="Clear filters" variant="secondary" onClick={tableState.resetFilters} />
              ) : undefined
            }
          />
        </Center>
      ) : (
        <VStack className={styles.scrollContainer} gap={0} ref={scrollElementRef}>
          <table
            role="table"
            aria-label="Agent operations table"
            aria-rowcount={visibleAgentIds.length + 1}
            className={styles.table}
            style={{ "--row-height": `${rowHeight}px`, width: getTableWidth(columnLayout) } as CSSProperties}
          >
            <thead role="rowgroup" className={styles.thead}>
              <tr role="row" aria-rowindex={1} className={styles.headerRow}>
                {columnLayout.map((column) => {
                  const header = headersById.get(column.id);
                  const canSort = header?.column.getCanSort() ?? false;

                  return (
                    <th
                      key={column.id}
                      role="columnheader"
                      aria-sort={ariaSortOf(header)}
                      className={headerCellClassName(column)}
                      scope="col"
                      style={headerCellStyle(column)}
                    >
                      {column.id === "select" ? (
                        <CheckboxInput
                          label="Select all filtered agents"
                          isLabelHidden
                          size="sm"
                          value={
                            table.getIsAllRowsSelected()
                              ? true
                              : table.getIsSomeRowsSelected()
                                ? "indeterminate"
                                : false
                          }
                          onChange={(checked) => table.toggleAllRowsSelected(checked)}
                        />
                      ) : canSort && header ? (
                        <button
                          type="button"
                          className={styles.sortButton}
                          title={String(header.column.columnDef.header ?? column.id)}
                          onClick={header.column.getToggleSortingHandler()}
                        >
                          <Text type="supporting" weight="medium" maxLines={1}>
                            {String(header.column.columnDef.header ?? column.id)}
                          </Text>
                          {sortIconOf(header)}
                        </button>
                      ) : (
                        <Text
                          type="supporting"
                          weight="medium"
                          maxLines={1}
                        >
                          {String(header?.column.columnDef.header ?? column.id)}
                        </Text>
                      )}

                      {header?.column.getCanResize() ? (
                        <span
                          className={styles.resizeHandle}
                          data-resizing={header.column.getIsResizing() ? "true" : undefined}
                          onMouseDown={header.getResizeHandler()}
                          onTouchStart={header.getResizeHandler()}
                          role="presentation"
                        />
                      ) : null}
                    </th>
                  );
                })}
              </tr>
            </thead>

            <tbody role="rowgroup" className={styles.tbody} style={{ height: virtualizer.getTotalSize() }}>
              {virtualRows.map((virtualRow) => {
                const agentId = visibleAgentIds[virtualRow.index];
                if (agentId === undefined) {
                  return null;
                }
                return (
                  <AgentTableRow
                    key={agentId}
                    agentId={agentId}
                    columnLayout={columnLayout}
                    isFocused={virtualRow.index === activeRowIndex}
                    isSelected={rowSelection[agentId] === true}
                    nowMs={nowMs}
                    offsetY={virtualRow.start}
                    onFocusRow={setFocusedRowIndex}
                    onOpenDetail={handleOpenDetail}
                    onRowAction={handleRowAction}
                    onRowKeyDown={handleRowKeyDown}
                    onToggleSelected={handleToggleSelected}
                    rowIndex={virtualRow.index}
                  />
                );
              })}
            </tbody>
          </table>
          <Center className={styles.workspaceRemainder}>
            <Text type="code" size="sm" color="secondary" hasTabularNumbers maxLines={1}>
              {visibleAgentIds.length} sessions in view · Select an agent name to inspect telemetry
            </Text>
          </Center>
        </VStack>
      )}

      {stopDialog}
    </VStack>
  );
}
