import { z } from "zod";

export const createTeamSchema = z.object({
	name: z.string().trim().min(1, "Team name is required").max(80),
	slug: z.string().trim().min(1).max(64).regex(/^[a-z0-9][a-z0-9-]*$/, "Team slug can only contain lowercase letters, digits and hyphens").optional(),
	description: z.string().trim().max(300).optional().nullable(),
});

export const switchTeamSchema = z.object({
	teamId: z.string().trim().min(1),
});

export const addTeamMemberSchema = z.object({
	username: z.string().trim().min(1),
	role: z.enum(["admin", "member"]).default("member"),
});

export const updateTeamSchema = z.object({
	name: z.string().trim().min(1, "Team name is required").max(80).optional(),
	description: z.string().trim().max(300).optional().nullable(),
});

export type CreateTeamInput = z.infer<typeof createTeamSchema>;
export type SwitchTeamInput = z.infer<typeof switchTeamSchema>;
export type AddTeamMemberInput = z.infer<typeof addTeamMemberSchema>;
export type UpdateTeamInput = z.infer<typeof updateTeamSchema>;
