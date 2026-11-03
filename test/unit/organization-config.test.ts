import { describe, expect, it } from "vitest";
import { OrganizationBrandingSchema, parseOrganizationSettings } from "@/server/validation/organization-config";

describe("organization settings", () => {
  it("fills safe defaults for an empty settings object (every module off)", () => {
    expect(parseOrganizationSettings({})).toEqual({
      features: { events: false, volunteers: false, inventory: false, certificates: false, ctf: false, feedback: false, analytics: false },
      notifications: { notifyReviewersOnNewRequest: true },
    });
  });

  it("keeps explicit choices and rejects unknown keys", () => {
    expect(parseOrganizationSettings({ features: { events: true } }).features.events).toBe(true);
    expect(() => parseOrganizationSettings({ features: { evnets: true } })).toThrow();
  });
});

describe("organization branding", () => {
  it("accepts https logos and hex colors only", () => {
    expect(OrganizationBrandingSchema.safeParse({ logoUrl: "https://cdn.example.test/l.png", primaryColor: "#1d4ed8" }).success).toBe(true);
    expect(OrganizationBrandingSchema.safeParse({ logoUrl: "http://cdn.example.test/l.png" }).success).toBe(false);
    expect(OrganizationBrandingSchema.safeParse({ primaryColor: "red; background:url(x)" }).success).toBe(false);
  });
});
