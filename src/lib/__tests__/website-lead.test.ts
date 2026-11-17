import { describe, expect, it } from "vitest";
import { fieldLabel, parseWebsiteLead, siteRegion, websiteLeadKey } from "@/lib/website-lead";

const now = new Date("2026-11-17T12:00:00Z");
const base = {
  site: "https://www.isto.ae/",
  submission_id: "a1b2c3d4-0001",
  form_id: "158",
  form_title: "Join Form",
  page_url: "https://isto.ae/contacts/",
  submitted_at: "2026-11-17T10:00:00Z",
  fields: {
    "your-name": "Sara",
    "your-tel": "+971 50 111 2233",
    "your-email": "sara@example.com",
    "your-message": "Villa in Dubai Hills",
    "project-type": ["Villa", "Interior"],
    "acceptance-policy": "1",
    _wpcf7_unit_tag: "wpcf7-f158",
  },
  utm: { utm_source: "google", utm_campaign: "brand" },
};

describe("website form lead", () => {
  it("splits contacts from answers and labels the source", () => {
    const r = parseWebsiteLead(base, now);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const l = r.lead;
    expect(l.site).toBe("isto.ae");
    expect(l.regionCode).toBe("dubai");
    expect(l.formName).toBe("Join Form");
    expect([l.fullName, l.phone, l.email]).toEqual(["Sara", "+971 50 111 2233", "sara@example.com"]);
    expect(l.answers).toEqual({
      Message: "Villa in Dubai Hills",
      "Project type": "Villa, Interior",
      "Сторінка": "https://isto.ae/contacts/",
      "UTM source": "google",
    });
    expect(l.campaignName).toBe("brand");
    expect(l.createdTime.toISOString()).toBe("2026-11-17T10:00:00.000Z");
    expect(websiteLeadKey(l)).toBe("web:isto.ae:a1b2c3d4-0001");
  });

  it("rejects forms without contacts or id", () => {
    expect(parseWebsiteLead({ ...base, fields: { "your-message": "hi" } }, now).ok).toBe(false);
    expect(parseWebsiteLead({ ...base, submission_id: "" }, now).ok).toBe(false);
    expect(parseWebsiteLead({ ...base, form_title: "" }, now).ok).toBe(false);
  });

  it("does not trust a future or broken clock", () => {
    const r = parseWebsiteLead({ ...base, submitted_at: "2030-01-01" }, now);
    expect(r.ok && r.lead.createdTime).toEqual(now);
  });

  it("maps sites to regions and field names to labels", () => {
    expect(siteRegion("isto.ro")).toBe("romania");
    expect(siteRegion("isto.ua")).toBeNull();
    expect(fieldLabel("your-message")).toBe("Message");
  });
});
