import assert from "node:assert/strict";
import test from "node:test";
import { normalizeDashboard } from "../src/multiTenant/platform/pages/dashboard/dashboardNormalization";

test("dashboard normalization prevents undefined, negative values, and NaN", () => {
  const result = normalizeDashboard({ summary: { companyCount: Number.NaN, activeCompanyCount: -2 } } as never);
  assert.equal(result.summary.companyCount, 0);
  assert.equal(result.summary.activeCompanyCount, 0);
  assert.deepEqual(result.monthlyCompanies, []);
});
