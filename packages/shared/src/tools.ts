import { z } from "zod"
import { SkillSchema } from "./skills"
import type {ToolName} from "./types"

export const RollCheckArgsSchema = z.object({
  characterId: z.string(),
  skill: SkillSchema,
  dc: z.number().int().min(5).max(25),
});
export type RollCheckArgs = z.infer<typeof RollCheckArgsSchema>

export const ApplyDamageArgsSchema = z.object({
  targetId: z.string(),
  diceCount: z.number().int().min(1).max(10),
  diceSides: z.literal([4, 6, 8, 10, 12, 20]),
  bonus: z.number().int().min(0).max(10),
});
export type ApplyDamageArgs = z.infer<typeof ApplyDamageArgsSchema>

export const AttackArgsSchema = z.object({
  attackerId: z.string(),
  weaponId: z.string(),
  targetId: z.string(),
})
export type AttackArg = z.infer<typeof AttackArgsSchema>

export const ToolArgsSchemas = {
  roll_check: RollCheckArgsSchema,
  apply_damage: ApplyDamageArgsSchema,
  attack: AttackArgsSchema,
} satisfies Record<ToolName, z.ZodType>
