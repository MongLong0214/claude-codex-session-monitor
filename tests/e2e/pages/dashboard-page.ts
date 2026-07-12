import type { Locator, Page } from "@playwright/test";

/** Escapes a string for safe use inside a `RegExp` — display names are real, uninvented user text. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Page Object for the dashboard's single route ("/"). Talks to the app's real, live local
 * repository data — no fixtures, no mocked API routes. Locators mirror the accessible
 * name/role contract asserted in the RTL suite (`operations-table.test.tsx`, `detail-panel.test.tsx`)
 * so both layers stay in sync with the same real component markup.
 */
export class DashboardPage {
  readonly page: Page;
  readonly table: Locator;
  readonly searchInput: Locator;
  readonly statusFilterTrigger: Locator;
  readonly projectFilterTrigger: Locator;
  readonly branchFilterTrigger: Locator;
  readonly columnsFilterTrigger: Locator;
  readonly densityGroup: Locator;
  readonly statusCounters: Locator;
  readonly detailPanel: Locator;

  constructor(page: Page) {
    this.page = page;
    this.table = page.getByRole("table", { name: "Agent operations table" });
    this.searchInput = page.getByRole("textbox", { name: "Search agents" });
    // 상태/열 표시 have no `hasSearch`, so MultiSelector's trigger IS the combobox. 프로젝트/브랜치
    // have hasSearch, so the visible trigger is a plain button that reveals a combobox once opened.
    this.statusFilterTrigger = page.getByRole("combobox", { name: "Status" });
    this.projectFilterTrigger = page.getByRole("button", { name: "Project", exact: true });
    this.branchFilterTrigger = page.getByRole("button", { name: "Branch", exact: true });
    this.columnsFilterTrigger = page.getByRole("combobox", { name: "Columns" });
    this.densityGroup = page.getByRole("radiogroup", { name: "Row density" });
    this.statusCounters = page.getByRole("list", { name: "Agent status summary" });
    this.detailPanel = page.getByRole("complementary", { name: "Agent details" });
  }

  async goto(): Promise<void> {
    // "load" not "networkidle": the dashboard opens a long-lived SSE connection
    // (/api/dashboard/events) that networkidle would wait forever for.
    await this.page.goto("/", { waitUntil: "load" });
    await this.table.waitFor({ state: "visible", timeout: 20_000 });
  }

  /** Hits the same endpoint the app itself reads from, to pick real fixtures deterministically. */
  async fetchSnapshot(): Promise<{
    allIds: string[];
    byId: Record<
      string,
      { id: string; displayName: string; source: "codex" | "claude_code"; runtimePids: number[] }
    >;
  }> {
    const response = await this.page.request.get("/api/dashboard/snapshot");
    return response.json();
  }

  /** Multiple live rows can share a displayName (e.g. identical team task prompts) — callers that
   * need a single row should scope further (e.g. via `.first()`) themselves. */
  rowsByDisplayName(displayName: string): Locator {
    return this.page.getByRole("row", { name: new RegExp(escapeRegExp(displayName)) });
  }

  detailButton(displayName: string): Locator {
    return this.page.getByRole("button", { name: `${displayName} details` });
  }

  async openDetailFor(displayName: string): Promise<void> {
    // Hundreds of live sessions can virtualize the target row out of the DOM — narrow via search
    // so the row renders, click, then restore the unfiltered table (panel selection persists).
    await this.search(displayName);
    await this.detailButton(displayName).first().click();
    await this.detailPanel.waitFor({ state: "visible" });
    await this.search("");
  }

  async closeDetail(): Promise<void> {
    await this.detailPanel.getByRole("button", { name: "Close detail panel" }).click();
  }

  async search(query: string): Promise<void> {
    await this.searchInput.fill(query);
    // SEARCH_DEBOUNCE_MS in use-table-state.ts is 200ms.
    await this.page.waitForTimeout(350);
  }

  statusCounterButton(label: string): Locator {
    return this.statusCounters.getByRole("button", { name: new RegExp(escapeRegExp(label)) });
  }

  visibleRowCountText(): Locator {
    return this.page.getByRole("toolbar", { name: "Agent table filters" }).locator("text=/\\d+ agents$/");
  }

  /**
   * The toolbar renders "N개" when every row is visible, or "N / M개" once a filter narrows the
   * set — the authoritative filtered/total counts, unlike counting rendered `<tbody>` rows (which
   * the virtualizer caps to whatever fits the viewport + overscan and so under-reports true totals).
   */
  async getRowCounts(): Promise<{ visible: number; total: number }> {
    const text = (await this.visibleRowCountText().textContent()) ?? "";
    const filtered = text.match(/^(\d+)\s+of\s+(\d+)\s+agents$/);
    if (filtered) {
      return { visible: Number(filtered[1]), total: Number(filtered[2]) };
    }
    const unfiltered = text.match(/^(\d+)\s+agents$/);
    const count = unfiltered ? Number(unfiltered[1]) : 0;
    return { visible: count, total: count };
  }

  bodyRows(): Locator {
    return this.table.locator("tbody tr[data-row-index]");
  }
}
