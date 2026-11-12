import { z } from "zod"
import { SkillSchema } from "./skills"
import type { ToolName } from "./types"
import { DiceSchema } from "./state"

export const RollCheckArgsSchema = z.object({
  characterId: z.string(),
  skill: SkillSchema,
  dc: z.number().int().min(5).max(25),
})
export type RollCheckArgs = z.infer<typeof RollCheckArgsSchema>

export const ApplyDamageArgsSchema = z.object({
  targetId: z.string(),
  ...DiceSchema.shape,
})
export type ApplyDamageArgs = z.infer<typeof ApplyDamageArgsSchema>

export const AttackArgsSchema = z.object({
  attackerId: z.string(),
  weaponId: z.string(),
  targetId: z.string(),
})
export type AttackArgs = z.infer<typeof AttackArgsSchema>

export const DeathSaveArgsSchema = z.object({
  characterId: z.string(),
})
export type DeathSaveArgs = z.infer<typeof DeathSaveArgsSchema>

export const ApplyHealArgsSchema = z.object({
  targetId: z.string(),
  ...DiceSchema.shape,
})
export type ApplyHealArgs = z.infer<typeof ApplyHealArgsSchema>

export const ToolArgsSchemas = {
  roll_check: RollCheckArgsSchema,
  apply_damage: ApplyDamageArgsSchema,
  attack: AttackArgsSchema,
  death_save: DeathSaveArgsSchema,
  apply_heal: ApplyHealArgsSchema,
} satisfies Record<ToolName, z.ZodType>
