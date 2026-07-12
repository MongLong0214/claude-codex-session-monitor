import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EnglishTimestamp } from "./english-timestamp";

afterEach(() => {
  vi.useRealTimers();
});

describe("EnglishTimestamp", () => {
  it("keeps relative display text and its full tooltip in English", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-10T12:02:00.000Z"));

    render(<EnglishTimestamp value="2026-07-10T12:00:00.000Z" />);

    const timestamp = screen.getByText("2 minutes ago");
    expect(timestamp).toHaveAttribute("title", expect.stringContaining("July"));
    expect(timestamp).toHaveAccessibleName(expect.stringContaining("July"));
  });

  it("renders absolute product timestamps with an explicit English locale", () => {
    render(<EnglishTimestamp value="2026-07-10T12:00:00.000Z" format="date_time" />);

    expect(screen.getByText(/Jul 10, 2026/)).toBeInTheDocument();
  });
});
