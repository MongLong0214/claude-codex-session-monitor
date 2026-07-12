import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { BulkActionBar } from "./bulk-action-bar";

describe("BulkActionBar", () => {
  it("renders the selected count", () => {
    render(<BulkActionBar selectedCount={3} isPending={false} onAction={vi.fn()} onClearSelection={vi.fn()} />);
    expect(screen.getByText("3 selected")).toBeInTheDocument();
  });

  it("calls onAction with the clicked action's type", async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    render(<BulkActionBar selectedCount={2} isPending={false} onAction={onAction} onClearSelection={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Pause" }));
    expect(onAction).toHaveBeenCalledExactlyOnceWith("pause");

    await user.click(screen.getByRole("button", { name: "Stop" }));
    expect(onAction).toHaveBeenLastCalledWith("stop");
  });

  it("calls onClearSelection when the clear button is clicked", async () => {
    const user = userEvent.setup();
    const onClearSelection = vi.fn();
    render(<BulkActionBar selectedCount={1} isPending={false} onAction={vi.fn()} onClearSelection={onClearSelection} />);

    await user.click(screen.getByRole("button", { name: "Clear selection" }));
    expect(onClearSelection).toHaveBeenCalledOnce();
  });

  it("disables every bulk action button while a bulk mutation is pending", () => {
    render(<BulkActionBar selectedCount={2} isPending onAction={vi.fn()} onClearSelection={vi.fn()} />);

    expect(screen.getByRole("button", { name: "Pause" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Resume" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Retry" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Stop" })).toBeDisabled();
  });

  it("keeps the clear-selection button enabled while a bulk mutation is pending", () => {
    render(<BulkActionBar selectedCount={2} isPending onAction={vi.fn()} onClearSelection={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Clear selection" })).toBeEnabled();
  });
});
