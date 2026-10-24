import { z } from "zod";

// Mirrors CHECK constraints in the migrations; the database remains the
// final authority. Validating here first gives users specific messages and
// keeps malformed input away from the database.

export const OrganizationSlug = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/, "Not a valid organization address")
  .refine((s) => !s.includes("--"), "Not a valid organization address");

const FieldKey = z.string().regex(/^[a-z][a-z0-9_]{0,39}$/);

export const ProfileAnswers = z
  .record(FieldKey, z.union([z.string().max(2000), z.number().finite(), z.null()]))
  .refine((answers) => Object.keys(answers).length <= 50, "Too many answers");

export const SubmitMembershipRequestInput = z.object({
  organizationSlug: OrganizationSlug,
  answers: ProfileAnswers.default({}),
});

export const WithdrawMembershipRequestInput = z.object({
  requestId: z.uuid(),
});

const Reason = z.string().trim().min(1).max(500);

export const ReviewMembershipRequestInput = z.discriminatedUnion("decision", [
  z.object({ decision: z.literal("approve"), organizationSlug: OrganizationSlug, requestId: z.uuid() }),
  z.object({
    decision: z.literal("reject"),
    organizationSlug: OrganizationSlug,
    requestId: z.uuid(),
    reason: Reason.optional(),
  }),
]);

export const SuspendMemberInput = z.object({
  organizationSlug: OrganizationSlug,
  membershipId: z.uuid(),
  reason: Reason.optional(),
});

export const ReinstateMemberInput = z.object({
  organizationSlug: OrganizationSlug,
  membershipId: z.uuid(),
});

export const ListPendingRequestsInput = z.object({
  organizationSlug: OrganizationSlug,
  cursor: z.string().max(200).optional(),
  limit: z.number().int().min(1).max(100).default(25),
});

export type SubmitMembershipRequestInput = z.input<typeof SubmitMembershipRequestInput>;
export type ReviewMembershipRequestInput = z.input<typeof ReviewMembershipRequestInput>;
export type SuspendMemberInput = z.input<typeof SuspendMemberInput>;
export type ReinstateMemberInput = z.input<typeof ReinstateMemberInput>;
export type ListPendingRequestsInput = z.input<typeof ListPendingRequestsInput>;
