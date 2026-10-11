import { z } from "zod";

export const createTeamSchema = z.object({
	name: z.string().trim().min(1, "Customer name is required").max(80),
	slug: z.string().trim().min(1).max(64).regex(/^[a-z0-9][a-z0-9-]*$/, "Slug can only contain lowercase letters, digits and hyphens").optional(),
	description: z.string().trim().max(300).optional().nullable(),
});

/** Administrators switch to a customer, or to null for all customers. */
export const switchTeamSchema = z.object({
	teamId: z.string().trim().min(1).nullable(),
});

/** Put an account into the customer (moving it from any other customer). */
export const setTeamMemberSchema = z.object({
	userId: z.string().trim().min(1),
	identityTemplateId: z.string().trim().min(1).nullable().optional(),
});

/** Change a member's identity template. */
export const updateTeamMemberSchema = z.object({
	identityTemplateId: z.string().trim().min(1),
});

export const updateTeamSchema = z.object({
	name: z.string().trim().min(1, "Customer name is required").max(80).optional(),
	description: z.string().trim().max(300).optional().nullable(),
});

export type CreateTeamInput = z.infer<typeof createTeamSchema>;
export type UpdateTeamInput = z.infer<typeof updateTeamSchema>;
