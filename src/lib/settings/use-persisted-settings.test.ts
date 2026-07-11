import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DASHBOARD_SETTINGS_STORAGE_KEY, DEFAULT_DASHBOARD_SETTINGS, type DashboardSettings } from "@/domain/settings";
import { readStoredSettings, usePersistedSettings, writeStoredSettings } from "./use-persisted-settings";

const STORED: DashboardSettings = {
  ...DEFAULT_DASHBOARD_SETTINGS,
  theme: "dark",
  sidebarCollapsed: true,
  rowDensity: "comfortable",
  statusFilter: ["failed"],
};

afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe("readStoredSettings", () => {
  it("returns defaults when nothing is stored", () => {
    expect(readStoredSettings()).toEqual(DEFAULT_DASHBOARD_SETTINGS);
  });

  it("returns the parsed value for a valid stored payload", () => {
    window.localStorage.setItem(DASHBOARD_SETTINGS_STORAGE_KEY, JSON.stringify(STORED));
    expect(readStoredSettings()).toEqual(STORED);
  });

  it("returns defaults for a non-JSON payload instead of throwing", () => {
    window.localStorage.setItem(DASHBOARD_SETTINGS_STORAGE_KEY, "}{ not json");
    expect(readStoredSettings()).toEqual(DEFAULT_DASHBOARD_SETTINGS);
  });

  it("returns defaults when localStorage.getItem throws (private mode)", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });
    expect(readStoredSettings()).toEqual(DEFAULT_DASHBOARD_SETTINGS);
  });

  it("returns independent defaults for separate missing-storage reads", () => {
    // Given / When: two consumers read the empty store.
    const first = readStoredSettings();
    const second = readStoredSettings();

    // Then: neither consumer receives shared mutable fallback state.
    expect(first).not.toBe(second);
    expect(first.visibleColumns).not.toBe(second.visibleColumns);
    expect(first.columnWidths).not.toBe(second.columnWidths);
  });
});

describe("writeStoredSettings", () => {
  it("round-trips through readStoredSettings", () => {
    writeStoredSettings(STORED);
    expect(readStoredSettings()).toEqual(STORED);
  });

  it("degrades to a no-op when setItem throws (quota/private mode)", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("quota", "QuotaExceededError");
    });
    expect(() => writeStoredSettings(STORED)).not.toThrow();
  });
});

describe("usePersistedSettings", () => {
  it("hydrates from localStorage after mount", () => {
    window.localStorage.setItem(DASHBOARD_SETTINGS_STORAGE_KEY, JSON.stringify(STORED));

    const { result } = renderHook(() => usePersistedSettings());

    expect(result.current.isHydrated).toBe(true);
    expect(result.current.settings).toEqual(STORED);
  });

  it("persists a partial update and reflects it in state and storage", () => {
    const { result } = renderHook(() => usePersistedSettings());

    act(() => {
      result.current.updateSettings({ theme: "light", sidebarCollapsed: true });
    });

    expect(result.current.settings.theme).toBe("light");
    expect(result.current.settings.sidebarCollapsed).toBe(true);
    expect(readStoredSettings().theme).toBe("light");
    expect(readStoredSettings().sidebarCollapsed).toBe(true);
  });

  it("merges a storage value that became visible before the next local update", () => {
    // Given: the mounted store has a cached snapshot, then another tab changes localStorage.
    const { result } = renderHook(() => usePersistedSettings());
    window.localStorage.setItem(
      DASHBOARD_SETTINGS_STORAGE_KEY,
      JSON.stringify({ ...DEFAULT_DASHBOARD_SETTINGS, sidebarCollapsed: true }),
    );

    // When: this tab updates an unrelated setting before receiving a storage event.
    act(() => {
      result.current.updateSettings({ theme: "dark" });
    });

    // Then: the external value and local patch are both retained.
    expect(result.current.settings.sidebarCollapsed).toBe(true);
    expect(result.current.settings.theme).toBe("dark");
    expect(readStoredSettings().sidebarCollapsed).toBe(true);
  });

  it("keeps updates in memory even when writing to storage fails", () => {
    const { result } = renderHook(() => usePersistedSettings());
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("quota", "QuotaExceededError");
    });

    act(() => {
      result.current.updateSettings({ theme: "dark" });
      result.current.updateSettings({ sidebarCollapsed: true });
    });

    expect(result.current.settings.theme).toBe("dark");
    expect(result.current.settings.sidebarCollapsed).toBe(true);
  });

  it("keeps a failed-write patch across storage events until a write succeeds", () => {
    // Given: a local theme update cannot be written.
    const { result } = renderHook(() => usePersistedSettings());
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("quota", "QuotaExceededError");
    });
    act(() => {
      result.current.updateSettings({ theme: "dark" });
    });
    setItem.mockRestore();

    // When: another tab changes storage and this tab later completes a successful update.
    window.localStorage.setItem(
      DASHBOARD_SETTINGS_STORAGE_KEY,
      JSON.stringify({ ...DEFAULT_DASHBOARD_SETTINGS, sidebarCollapsed: true }),
    );
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: DASHBOARD_SETTINGS_STORAGE_KEY }));
    });
    act(() => {
      result.current.updateSettings({ rowDensity: "comfortable" });
    });

    // Then: external, failed-write, and successful values all survive in memory and storage.
    expect(result.current.settings.theme).toBe("dark");
    expect(result.current.settings.sidebarCollapsed).toBe(true);
    expect(readStoredSettings()).toMatchObject({
      theme: "dark",
      sidebarCollapsed: true,
      rowDensity: "comfortable",
    });
  });
});
