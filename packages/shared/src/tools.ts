import { z } from "zod";
import { SkillSchema } from "./skills";
import type {ToolName} from "./types";

export const RollCheckArgsSchema = z.object({
  characterId: z.string(),
  skill: SkillSchema,
  dc: z.number().int().min(5).max(25),
});
export type RollCheckArgs = z.infer<typeof RollCheckArgsSchema>;

export const ApplyDamageArgsSchema = z.object({
  targetId: z.string(),
  amount: z.number().int().positive(),
});
export type ApplyDamageArgs = z.infer<typeof ApplyDamageArgsSchema>;

export const ToolArgsSchemas = {
  roll_check: RollCheckArgsSchema,
  apply_damage: ApplyDamageArgsSchema,
} satisfies Record<ToolName, z.ZodType>
