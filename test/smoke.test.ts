import { describe, expect, it } from "vitest";

// Smoke test so `npm test` exits 0 before real suites land (P1.M1.T2.S2+).
describe("smoke", () => {
  it("passes trivially", () => {
    expect(true).toBe(true);
  });
});