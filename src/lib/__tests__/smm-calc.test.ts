import { describe, expect, it } from "vitest";
import { cpl, cr, erReach, highlights, net, nextMonth, prevMonth, totals, type SmmRow } from "@/lib/smm-calc";

const row = (month: string, d: SmmRow["d"]): SmmRow => ({ month, source: "report", d, notes: {}, manual: [], partial: false });

describe("smm calc", () => {
  it("derives net, ER, CR and cost per lead", () => {
    const d = { followersStart: 100, followersEnd: 130, interactions: 50, reach: 1000, leads: 10, profileVisits: 500, spend: 2000 };
    expect(net(d)).toBe(30);
    expect(erReach(d)).toBe(0.05);
    expect(cr(d)).toBe(0.02);
    expect(cpl(d)).toBe(200);
    expect(cpl({ spend: 100 })).toBeNull();
  });

  it("weights yearly ratios by volume and spans the year for followers", () => {
    const t = totals([
      row("2026-01", { followersStart: 100, followersEnd: 110, interactions: 10, reach: 100, leads: 1, spend: 100 }),
      row("2026-02", { followersStart: 110, followersEnd: 150, interactions: 10, reach: 900, leads: 3, spend: 500 }),
    ]);
    expect(t.net).toBe(50);
    expect(t.erReach).toBeCloseTo(20 / 1000);
    expect(t.cpl).toBe(150);
    expect(t.posts).toBeNull();
  });

  it("steps months across years", () => {
    expect(prevMonth("2026-01")).toBe("2025-12");
    expect(nextMonth("2025-12")).toBe("2026-01");
  });

  it("writes highlights from the data", () => {
    const h = highlights([
      row("2026-01", { followersStart: 100, followersEnd: 110, viewsTotal: 5, reach: 3, leads: 2, spend: 600 }),
      row("2026-02", { followersStart: 110, followersEnd: 150, viewsTotal: 9, reach: 4, leads: 3, spend: 300 }),
    ]);
    expect(h[0]).toContain("+50");
    expect(h.join(" ")).toContain("лютий 2026, +40");
    expect(h.join(" ")).toContain("100 AED");
  });
});
