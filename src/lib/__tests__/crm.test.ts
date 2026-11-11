import { describe, expect, it } from "vitest";
import { leadContact, prettyAnswer } from "@/lib/lead-contact";
import { leadFlags } from "@/lib/lead-flags";
import { businessMinutes, isWorkingTime, slaCutoff } from "@/lib/sla";
import { normalizeStatus, parseStatus } from "@/lib/statuses";
import { romiMath } from "@/lib/money";
import { fmtPctAuto, fmtPctValue } from "@/lib/format";
import { phoneKey, platformLabel } from "@/lib/lead-source";

// App timezone defaults to Asia/Dubai (UTC+4), working time Mon–Fri 9:00–19:00.
const dubai = (iso: string) => new Date(iso + "+04:00");

describe("working time", () => {
  it("counts only work hours", () => {
    expect(businessMinutes(dubai("2026-11-11T10:00:00"), dubai("2026-11-11T10:45:00"))).toBe(45);
    // Night lead: the clock starts at 9:00.
    expect(businessMinutes(dubai("2026-11-11T02:47:00"), dubai("2026-11-11T09:20:00"))).toBe(20);
    // Evening to next morning: 30 min before close + 15 after open.
    expect(businessMinutes(dubai("2026-11-11T18:30:00"), dubai("2026-11-12T09:15:00"))).toBe(45);
  });
  it("skips the weekend", () => {
    // Friday 18:00 → Monday 10:00 = 60 + 60.
    expect(businessMinutes(dubai("2026-11-13T18:00:00"), dubai("2026-11-16T10:00:00"))).toBe(120);
    expect(isWorkingTime(dubai("2026-11-14T12:00:00"))).toBe(false);
    expect(isWorkingTime(dubai("2026-11-12T12:00:00"))).toBe(true);
  });
  it("cutoff is the moment exactly SLA working minutes ago", () => {
    const now = dubai("2026-11-12T09:10:00");
    const cut = slaCutoff(now, 30);
    expect(businessMinutes(cut, now)).toBe(30);
    expect(cut.toISOString()).toBe(dubai("2026-11-11T18:40:00").toISOString());
  });
});

describe("lead contact", () => {
  const lead = { fullName: null, phone: null, email: null, city: null, regionCode: "dubai", answers: { "your name": "Sara", "phone number": "+971501112233", city: "Dubai", service: "apartment_/_penthouse" } };
  it("takes contacts from custom questions and leaves the rest as interest", () => {
    const c = leadContact(lead);
    expect(c.name).toBe("Sara");
    expect(c.phone).toBe("+971501112233");
    expect(c.city).toBe("Dubai");
    expect(c.interest).toEqual({ service: "Apartment / penthouse" });
  });
  it("makes option codes readable but leaves free text", () => {
    expect(prettyAnswer("both_of_it")).toBe("Both of it");
    expect(prettyAnswer("full_design_&_build")).toBe("Full design & build");
    expect(prettyAnswer("my_email is a_b@x.com")).toBe("my_email is a_b@x.com");
  });
});

describe("lead hints", () => {
  const base = { fullName: "A", email: null, city: "Dubai", regionCode: "dubai", answers: {} };
  it("flags a phone from another country only when the code is explicit", () => {
    expect(leadFlags({ ...base, phone: "+919939261825" }).map((f) => f.label)).toEqual(["номер +91"]);
    expect(leadFlags({ ...base, phone: "+971559984842" })).toEqual([]);
    expect(leadFlags({ ...base, phone: "0559984842" })).toEqual([]);
    expect(leadFlags({ ...base, phone: "+919939261825", regionCode: "eu" })).toEqual([]);
  });
  it("spots suppliers and junk", () => {
    expect(leadFlags({ ...base, phone: null, city: "we are an authorized supplier of lighting" }).map((f) => f.code)).toEqual(["supplier"]);
    expect(leadFlags({ ...base, phone: null, city: "TT" }).map((f) => f.code)).toEqual(["junk"]);
  });
});

describe("statuses", () => {
  it("normalises sheet values and is strict for the bot", () => {
    expect(normalizeStatus("Follow-up")).toBe("follow_up");
    expect(normalizeStatus("something else")).toBe("new");
    expect(parseStatus("Proposal sent")).toBe("proposal");
    expect(parseStatus("something else")).toBeNull();
  });
});

describe("money", () => {
  it("ROMI ignores revenue in another currency", () => {
    expect(romiMath(1000, "AED", { AED: 3000, USD: 500 })).toEqual({ revenue: 3000, otherCurrency: true, romi: 2 });
    expect(romiMath(1000, "AED", {}).romi).toBeNull();
  });
});

describe("manual leads", () => {
  it("phone key matches the same number written differently", () => {
    expect(phoneKey("+971 55 998 48 42")).toBe(phoneKey("0559984842"));
    expect(phoneKey("+971559984842")).toBe("559984842");
    expect(phoneKey("12345")).toBeNull();
    expect(phoneKey(null)).toBeNull();
  });
  it("names the source of a hand-typed lead", () => {
    expect(platformLabel("call")).toBe("Дзвінок");
    expect(platformLabel("ig")).toBe("Instagram");
    expect(platformLabel(null)).toBeNull();
  });
});

describe("percent display", () => {
  it("keeps meaning when the share is tiny", () => {
    expect(fmtPctAuto(2 / 138074)).toBe("0,0014%"); // +2 followers out of 138 074
    expect(fmtPctAuto(97 / 235237)).toBe("0,041%");
    expect(fmtPctAuto(378 / 260204)).toBe("0,15%");
    expect(fmtPctAuto(-11 / 371059)).toBe("-0,003%");
    expect(fmtPctAuto(0.0734)).toBe("7,3%");
    expect(fmtPctAuto(0)).toBe("0%");
    expect(fmtPctAuto(0.0000002)).toBe("≈0%");
  });
  it("formats values already in percent units", () => {
    expect(fmtPctValue(0.001)).toBe("0,001%");
    expect(fmtPctValue(12.345)).toBe("12%");
  });
});
