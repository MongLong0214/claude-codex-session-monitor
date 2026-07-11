import { describe, expect, it } from "vitest";
import { DEFAULT_DASHBOARD_SETTINGS, parseDashboardSettings } from "./settings";

describe("parseDashboardSettings", () => {
  it("returns defaults for undefined (first run, nothing in localStorage yet)", () => {
    expect(parseDashboardSettings(undefined)).toEqual(DEFAULT_DASHBOARD_SETTINGS);
  });

  it("returns defaults for corrupted/malformed JSON shapes", () => {
    expect(parseDashboardSettings({ theme: "not-a-real-theme" })).toEqual(DEFAULT_DASHBOARD_SETTINGS);
    expect(parseDashboardSettings("a raw string, not an object")).toEqual(DEFAULT_DASHBOARD_SETTINGS);
    expect(parseDashboardSettings(null)).toEqual(DEFAULT_DASHBOARD_SETTINGS);
  });

  it("returns defaults when schemaVersion is missing or from a future/unknown version", () => {
    const { schemaVersion: _schemaVersion, ...withoutVersion } = DEFAULT_DASHBOARD_SETTINGS;
    expect(parseDashboardSettings(withoutVersion)).toEqual(DEFAULT_DASHBOARD_SETTINGS);
    expect(parseDashboardSettings({ ...DEFAULT_DASHBOARD_SETTINGS, schemaVersion: 99 })).toEqual(
      DEFAULT_DASHBOARD_SETTINGS,
    );
  });

  it("round-trips a valid, fully-populated settings object unchanged", () => {
    const valid = {
      schemaVersion: 1 as const,
      theme: "dark" as const,
      sidebarCollapsed: true,
      rowDensity: "comfortable" as const,
      visibleColumns: ["status", "agent"],
      columnWidths: { agent: 220 },
      statusFilter: ["failed", "blocked"],
      projectFilter: ["/Users/dev/WebstormProjects/v3"],
      branchFilter: ["dev"],
      sort: [{ id: "status", desc: false }],
    };
    expect(parseDashboardSettings(valid)).toEqual(valid);
  });

  it("returns independent fallback settings for separate invalid inputs", () => {
    // Given / When: two invalid persisted payloads are parsed independently.
    const first = parseDashboardSettings(undefined);
    const second = parseDashboardSettings(null);

    // Then: callers cannot share or mutate the same fallback collections.
    expect(first).not.toBe(second);
    expect(first.visibleColumns).not.toBe(second.visibleColumns);
    expect(first.columnWidths).not.toBe(second.columnWidths);
    expect(first.statusFilter).not.toBe(second.statusFilter);
    expect(first.projectFilter).not.toBe(second.projectFilter);
    expect(first.branchFilter).not.toBe(second.branchFilter);
    expect(first.sort).not.toBe(second.sort);
  });

  it("rejects column widths outside the persisted 40 through 2000 pixel range", () => {
    // Given / When: corrupted storage supplies widths below and above the usable range.
    const tooSmall = parseDashboardSettings({ ...DEFAULT_DASHBOARD_SETTINGS, columnWidths: { agent: 39 } });
    const tooLarge = parseDashboardSettings({ ...DEFAULT_DASHBOARD_SETTINGS, columnWidths: { agent: 2_001 } });

    // Then: both payloads reset to defaults.
    expect(tooSmall).toEqual(DEFAULT_DASHBOARD_SETTINGS);
    expect(tooLarge).toEqual(DEFAULT_DASHBOARD_SETTINGS);
  });

  it("rejects unknown or oversized status filters", () => {
    // Given / When: persisted status ids are outside the domain or exceed its nine values.
    const unknown = parseDashboardSettings({ ...DEFAULT_DASHBOARD_SETTINGS, statusFilter: ["not-a-status"] });
    const oversized = parseDashboardSettings({
      ...DEFAULT_DASHBOARD_SETTINGS,
      statusFilter: Array.from({ length: 10 }, () => "failed"),
    });

    // Then: neither payload crosses the settings boundary.
    expect(unknown).toEqual(DEFAULT_DASHBOARD_SETTINGS);
    expect(oversized).toEqual(DEFAULT_DASHBOARD_SETTINGS);
  });

  it("bounds persisted project and branch filter ids", () => {
    // Given / When: persisted filters exceed their path/ref resource limits.
    const projects = parseDashboardSettings({
      ...DEFAULT_DASHBOARD_SETTINGS,
      projectFilter: Array.from({ length: 101 }, (_, index) => `/repo/${index}`),
    });
    const branches = parseDashboardSettings({
      ...DEFAULT_DASHBOARD_SETTINGS,
      branchFilter: ["b".repeat(1_025)],
    });

    // Then: both corrupted payloads reset to defaults.
    expect(projects).toEqual(DEFAULT_DASHBOARD_SETTINGS);
    expect(branches).toEqual(DEFAULT_DASHBOARD_SETTINGS);
  });

  it("bounds persisted sorting to the finite table surface", () => {
    // Given / When: persisted sorting exceeds the column count or carries an oversized id.
    const tooMany = parseDashboardSettings({
      ...DEFAULT_DASHBOARD_SETTINGS,
      sort: Array.from({ length: 16 }, (_, index) => ({ id: `column-${index}`, desc: false })),
    });
    const oversizedId = parseDashboardSettings({
      ...DEFAULT_DASHBOARD_SETTINGS,
      sort: [{ id: "s".repeat(65), desc: false }],
    });

    // Then: both corrupted payloads reset to defaults.
    expect(tooMany).toEqual(DEFAULT_DASHBOARD_SETTINGS);
    expect(oversizedId).toEqual(DEFAULT_DASHBOARD_SETTINGS);
  });
});
