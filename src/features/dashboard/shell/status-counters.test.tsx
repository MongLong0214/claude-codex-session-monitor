import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { buildMockSnapshot } from "@/data-access/mock-adapter";
import { StatusCounters } from "./status-counters";

/** Reuses the project's shared deterministic fixture rather than inventing a bespoke summary. */
const SUMMARY = buildMockSnapshot(Date.parse("2026-07-10T12:00:00.000Z")).summary;

describe("StatusCounters", () => {
  it("renders a counter with the status label and count for every tracked status kind", () => {
    render(<StatusCounters summary={SUMMARY} activeFilter={[]} onToggleFilter={vi.fn()} />);

    expect(screen.getByRole("button", { name: /Failed/ })).toHaveTextContent(String(SUMMARY.statusCounts.failed));
    expect(screen.getByRole("button", { name: /Blocked/ })).toHaveTextContent(String(SUMMARY.statusCounts.blocked));
    expect(screen.getByRole("button", { name: /Stale/ })).toHaveTextContent(String(SUMMARY.statusCounts.stale));
    expect(screen.getByRole("button", { name: /Offline/ })).toHaveTextContent(String(SUMMARY.statusCounts.offline));
    expect(screen.getByRole("button", { name: /Running/ })).toHaveTextContent(String(SUMMARY.statusCounts.running));
  });

  it("AC: clicking a status counter calls onToggleFilter with that counter's status kind", async () => {
    const user = userEvent.setup();
    const onToggleFilter = vi.fn();
    render(<StatusCounters summary={SUMMARY} activeFilter={[]} onToggleFilter={onToggleFilter} />);

    await user.click(screen.getByRole("button", { name: /Failed/ }));
    expect(onToggleFilter).toHaveBeenCalledExactlyOnceWith("failed");

    await user.click(screen.getByRole("button", { name: /Blocked/ }));
    expect(onToggleFilter).toHaveBeenLastCalledWith("blocked");
  });

  it("marks only the active filter's counter as pressed", () => {
    render(<StatusCounters summary={SUMMARY} activeFilter={["blocked"]} onToggleFilter={vi.fn()} />);

    expect(screen.getByRole("button", { name: /Blocked/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /Failed/ })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: /Offline/ })).toHaveAttribute("aria-pressed", "false");
  });

  it("renders the overall total agent and active project counts", () => {
    render(<StatusCounters summary={SUMMARY} activeFilter={[]} onToggleFilter={vi.fn()} />);

    expect(screen.getByText(`Total ${SUMMARY.totalAgents} · Projects ${SUMMARY.activeProjects}`)).toBeInTheDocument();
  });
});
