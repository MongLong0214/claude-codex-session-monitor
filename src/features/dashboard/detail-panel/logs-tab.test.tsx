import { QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeProvider } from "@/components/providers/theme-provider";
import type { AgentId } from "@/domain/agent/agent";
import { fetchAgentLogs } from "@/lib/query/api";
import { createQueryClient } from "@/lib/query/query-client";
import { LogsTab } from "./logs-tab";

vi.mock("@/lib/query/api", () => ({
  fetchAgentLogs: vi.fn(),
}));

const AGENT_ID: AgentId = "mock-main-monitor";
const NEXT_AGENT_ID: AgentId = "mock-sub-table";

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
  reject(error: Error): void;
}

function deferred<T>(): Deferred<T> {
  let resolvePromise: ((value: T) => void) | undefined;
  let rejectPromise: ((error: Error) => void) | undefined;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return {
    promise,
    resolve(value) {
      if (!resolvePromise) throw new Error("deferred resolve missing");
      resolvePromise(value);
    },
    reject(error) {
      if (!rejectPromise) throw new Error("deferred reject missing");
      rejectPromise(error);
    },
  };
}

function renderLogsTab(agentId: AgentId = AGENT_ID) {
  const queryClient = createQueryClient();
  const tree = (nextAgentId: AgentId) => (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <LogsTab agentId={nextAgentId} />
      </QueryClientProvider>
    </ThemeProvider>
  );
  const view = render(tree(agentId));
  return { ...view, rerenderAgent: (nextAgentId: AgentId) => view.rerender(tree(nextAgentId)) };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(fetchAgentLogs).mockResolvedValue({
    agentId: AGENT_ID,
    lines: [{ id: "1", timestamp: "2026-07-10T12:00:00.000Z", level: "info", text: "테스트 로그" }],
    isTruncated: false,
  });
});

describe("LogsTab copy", () => {
  it("shows copied feedback after the clipboard write succeeds", async () => {
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, "writeText");
    writeText.mockResolvedValue();
    renderLogsTab();
    await screen.findByText("테스트 로그");

    await user.click(screen.getByRole("button", { name: "복사" }));

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledExactlyOnceWith("2026-07-10T12:00:00.000Z\t테스트 로그");
    });
    expect(await screen.findByRole("button", { name: "복사됨" })).toBeInTheDocument();
  });

  it("shows an error banner when the clipboard write is rejected", async () => {
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, "writeText");
    writeText.mockRejectedValue(new Error("클립보드 권한이 없습니다."));
    renderLogsTab();
    await screen.findByText("테스트 로그");

    await user.click(screen.getByRole("button", { name: "복사" }));

    expect(await screen.findByText("로그를 복사하지 못했습니다")).toBeInTheDocument();
    expect(screen.getByText("클립보드 권한이 없습니다.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "복사" })).toBeInTheDocument();
  });

  it("keeps newer success feedback when an older clipboard write rejects later", async () => {
    // Given
    const user = userEvent.setup();
    const olderWrite = deferred<void>();
    const writeText = vi.spyOn(navigator.clipboard, "writeText");
    writeText.mockReturnValueOnce(olderWrite.promise).mockResolvedValueOnce();
    renderLogsTab();
    await screen.findByText("테스트 로그");

    // When
    await user.click(screen.getByRole("button", { name: "복사" }));
    await user.click(screen.getByRole("button", { name: "복사" }));
    expect(await screen.findByRole("button", { name: "복사됨" })).toBeInTheDocument();
    await act(async () => {
      olderWrite.reject(new Error("뒤늦은 실패"));
      await Promise.resolve();
    });

    // Then
    expect(screen.getByRole("button", { name: "복사됨" })).toBeInTheDocument();
    expect(screen.queryByText("로그를 복사하지 못했습니다")).not.toBeInTheDocument();
  });

  it("clears settled copy feedback when the selected agent changes", async () => {
    // Given
    const user = userEvent.setup();
    vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
    const view = renderLogsTab();
    await screen.findByText("테스트 로그");
    await user.click(screen.getByRole("button", { name: "복사" }));
    expect(await screen.findByRole("button", { name: "복사됨" })).toBeInTheDocument();

    // When
    view.rerenderAgent(NEXT_AGENT_ID);

    // Then
    expect(await screen.findByRole("button", { name: "복사" })).toBeInTheDocument();
    expect(screen.queryByText("로그를 복사하지 못했습니다")).not.toBeInTheDocument();
  });

  it("ignores a pending clipboard completion after the selected agent changes", async () => {
    // Given
    const user = userEvent.setup();
    const oldWrite = deferred<void>();
    vi.spyOn(navigator.clipboard, "writeText").mockReturnValue(oldWrite.promise);
    const view = renderLogsTab();
    await screen.findByText("테스트 로그");
    await user.click(screen.getByRole("button", { name: "복사" }));

    // When
    view.rerenderAgent(NEXT_AGENT_ID);
    await waitFor(() => expect(screen.getByRole("button", { name: "복사" })).toBeEnabled());
    await act(async () => {
      oldWrite.resolve(undefined);
      await oldWrite.promise;
    });

    // Then
    expect(screen.getByRole("button", { name: "복사" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "복사됨" })).not.toBeInTheDocument();
  });
});
