import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ThemeProvider } from "@/components/providers/theme-provider";
import { buildMockSnapshot } from "@/data-access/mock-adapter";
import { ProgressCell, ProjectBranchCell } from "./table-cells";

const AGENT = Object.values(buildMockSnapshot(Date.parse("2026-07-10T12:00:00.000Z")).byId).find(
  (agent) => agent.branch !== null,
);

describe("table cells", () => {
  it("exposes complete project and branch values from one compact group", () => {
    expect(AGENT).toBeDefined();
    render(
      <ThemeProvider>
        <ProjectBranchCell agent={AGENT!} />
      </ThemeProvider>,
    );

    const group = screen.getByRole("group", { name: "Project and branch" });
    expect(group).toHaveAttribute("data-direction", "horizontal");
    expect(group).toHaveTextContent(AGENT!.project.name);
    expect(group).toHaveTextContent(AGENT!.branch!);
  });

  it("keeps running progress explicitly indeterminate and completed progress explicit", () => {
    const { rerender } = render(
      <ThemeProvider>
        <ProgressCell
          status={{
            kind: "running",
            startedAt: "2026-07-10T11:00:00.000Z",
            lastHeartbeatAt: "2026-07-10T12:00:00.000Z",
          }}
        />
      </ThemeProvider>,
    );

    expect(screen.getByLabelText("Running activity; progress is indeterminate")).toBeInTheDocument();

    rerender(
      <ThemeProvider>
        <ProgressCell status={{ kind: "completed", completedAt: "2026-07-10T12:00:00.000Z" }} />
      </ThemeProvider>,
    );
    expect(screen.getByLabelText("Completed")).toBeInTheDocument();
  });
});
