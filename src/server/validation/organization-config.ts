import { z } from "zod";

/**
 * Shapes of organizations.branding and organizations.settings (JSONB).
 * The database only guarantees these are JSON objects; these schemas give
 * them explicit types and safe defaults. Unknown keys are rejected so typos
 * fail loudly instead of being silently ignored.
 *
 * Extension point: add a key here with a default, then use it. Existing
 * rows keep working because every key is optional with a default.
 */
export const OrganizationBrandingSchema = z
  .object({
    shortName: z.string().trim().min(1).max(40).optional(),
    logoUrl: z.url({ protocol: /^https$/ }).max(500).optional(),
    primaryColor: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/, "Use a hex color such as #1d4ed8")
      .optional(),
  })
  .strict();

// Every module ships disabled; an organization opts in.
export const OrganizationSettingsSchema = z
  .object({
    features: z
      .object({
        events: z.boolean().default(false),
        volunteers: z.boolean().default(false),
        inventory: z.boolean().default(false),
        certificates: z.boolean().default(false),
        analytics: z.boolean().default(false),
      })
      .strict()
      .prefault({}),
    notifications: z
      .object({
        notifyReviewersOnNewRequest: z.boolean().default(true),
      })
      .strict()
      .prefault({}),
  })
  .strict();

export type OrganizationBranding = z.output<typeof OrganizationBrandingSchema>;
export type OrganizationSettings = z.output<typeof OrganizationSettingsSchema>;
export type FeatureKey = keyof OrganizationSettings["features"];

/** Reads stored settings, filling defaults. Throws if the stored JSON is invalid. */
export function parseOrganizationSettings(raw: unknown): OrganizationSettings {
  return OrganizationSettingsSchema.parse(raw ?? {});
}
