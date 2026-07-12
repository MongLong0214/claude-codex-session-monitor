import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { DashboardPage } from "./pages/dashboard-page";

test.describe("Accessibility", () => {
  for (const colorScheme of ["dark", "light"] as const) {
    test(`AC: the loaded ${colorScheme} dashboard has no axe-core violations`, async ({ page }, testInfo) => {
      await page.emulateMedia({ colorScheme });
      const dashboard = new DashboardPage(page);
      await dashboard.goto();

      const results = await new AxeBuilder({ page }).analyze();
      await testInfo.attach(`axe-results-dashboard-${colorScheme}.json`, {
        body: JSON.stringify(results.violations, null, 2),
        contentType: "application/json",
      });

      expect(results.violations, formatViolations(results.violations)).toEqual([]);
    });

    test(`AC: the loaded ${colorScheme} mobile dashboard has no axe-core violations`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width: 375, height: 812 });
      await page.emulateMedia({ colorScheme });
      const dashboard = new DashboardPage(page);
      await dashboard.goto();

      const results = await new AxeBuilder({ page }).analyze();
      await testInfo.attach(`axe-results-dashboard-375-${colorScheme}.json`, {
        body: JSON.stringify(results.violations, null, 2),
        contentType: "application/json",
      });

      expect(results.violations, formatViolations(results.violations)).toEqual([]);
    });

    test(`AC: the ${colorScheme} dashboard detail panel has no axe-core violations`, async ({ page }, testInfo) => {
      await page.emulateMedia({ colorScheme });
      const dashboard = new DashboardPage(page);
      await dashboard.goto();

      const snapshot = await dashboard.fetchSnapshot();
      const target = Object.values(snapshot.byId)[0];
      test.skip(!target, "No live agents to open a detail panel for.");
      await dashboard.openDetailFor(target!.displayName);

      const results = await new AxeBuilder({ page }).analyze();
      await testInfo.attach(`axe-results-detail-panel-${colorScheme}.json`, {
        body: JSON.stringify(results.violations, null, 2),
        contentType: "application/json",
      });

      expect(results.violations, formatViolations(results.violations)).toEqual([]);
    });
  }
});

function formatViolations(violations: { id: string; impact?: string | null; help: string; nodes: unknown[] }[]): string {
  if (violations.length === 0) {
    return "no violations";
  }
  return violations
    .map((violation) => `[${violation.impact ?? "unknown"}] ${violation.id}: ${violation.help} (${violation.nodes.length} node(s))`)
    .join("\n");
}
