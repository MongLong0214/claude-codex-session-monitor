import { expect, test } from "@playwright/test";
import { DashboardPage } from "./pages/dashboard-page";

test.describe("Detail panel", () => {
  test("AC: opens on clicking a row's detail button and shows the overview/logs/changes tabs", async ({ page }) => {
    const dashboard = new DashboardPage(page);
    await dashboard.goto();

    const snapshot = await dashboard.fetchSnapshot();
    const target = Object.values(snapshot.byId)[0];
    test.skip(!target, "No live agents to open a detail panel for.");

    await dashboard.openDetailFor(target!.displayName);

    await expect(dashboard.detailPanel).toContainText(target!.displayName);
    const tabs = dashboard.detailPanel.getByRole("navigation", { name: "Agent detail tabs" });
    await expect(tabs.getByRole("button", { name: "Overview" })).toBeVisible();
    await expect(tabs.getByRole("button", { name: "Logs" })).toBeVisible();
    await expect(tabs.getByRole("button", { name: "Changes" })).toBeVisible();

    await tabs.getByRole("button", { name: "Logs" }).click();
    await expect(dashboard.detailPanel.getByRole("log", { name: "Agent activity log" })).toBeVisible();
  });
});

test.describe("Pause/Resume availability", () => {
  test("AC: an agent with a real observed runtime pid gets enabled pause/resume", async ({ page }) => {
    const dashboard = new DashboardPage(page);
    await dashboard.goto();

    const snapshot = await dashboard.fetchSnapshot();
    const withPid = Object.values(snapshot.byId).find((agent) => agent.runtimePids.length > 0);
    test.skip(!withPid, "No live agent with an observed runtime pid right now.");

    await dashboard.openDetailFor(withPid!.displayName);

    await expect(dashboard.detailPanel.getByRole("button", { name: "Pause (SIGSTOP)" })).toBeEnabled();
    await expect(dashboard.detailPanel.getByRole("button", { name: "Resume (SIGCONT)" })).toBeEnabled();
  });

  test("AC: a Claude-Code-sourced agent (never a runtime pid) renders pause/resume disabled with a reason", async ({
    page,
  }) => {
    const dashboard = new DashboardPage(page);
    await dashboard.goto();

    const snapshot = await dashboard.fetchSnapshot();
    const claudeCodeAgent = Object.values(snapshot.byId).find((agent) => agent.source === "claude_code");
    test.skip(!claudeCodeAgent, "No live Claude-Code-sourced agent right now.");

    await dashboard.openDetailFor(claudeCodeAgent!.displayName);

    const pauseButton = dashboard.detailPanel.getByRole("button", { name: "Pause (SIGSTOP)" });
    await expect(pauseButton).toBeDisabled();
    await expect(dashboard.detailPanel.getByRole("button", { name: "Resume (SIGCONT)" })).toBeDisabled();
    await expect(
      dashboard.detailPanel.getByText("No running Codex process was found in the working directory.").first(),
    ).toBeAttached();
  });
});

test.describe("Stop confirmation", () => {
  test("AC: Stop opens a confirmation dialog, and Cancel closes it without sending SIGTERM to a real process", async ({
    page,
  }) => {
    const dashboard = new DashboardPage(page);
    await dashboard.goto();

    const snapshot = await dashboard.fetchSnapshot();
    const withPid = Object.values(snapshot.byId).find((agent) => agent.runtimePids.length > 0);
    test.skip(!withPid, "No live agent with an observed runtime pid right now.");

    await dashboard.openDetailFor(withPid!.displayName);
    await dashboard.detailPanel.getByRole("button", { name: "Stop", exact: true }).click();

    // Scoped to the currently-open <dialog> — other alertdialog instances may exist elsewhere in
    // the tree (e.g. an unrelated feature's own confirmation) but only one has the native `open` attribute.
    const openDialog = page.locator('dialog[role="alertdialog"][open]');
    await expect(openDialog).toBeVisible();
    await expect(openDialog).toContainText(`Stop ${withPid!.displayName}`);

    // Deliberately never click the action button here — confirming would send a real SIGTERM to a
    // real running process on this machine, which is destructive and out of scope for a test.
    await openDialog.getByRole("button", { name: "Cancel" }).click();
    await expect(page.locator('dialog[role="alertdialog"][open]')).toHaveCount(0);
  });
});
