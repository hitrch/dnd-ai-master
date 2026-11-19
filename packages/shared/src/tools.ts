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

export const StartCombatArgsSchema = z.object({
  participantIds: z.array(z.string()).min(2),
})
export type StartCombatArgs = z.infer<typeof StartCombatArgsSchema>

export const EndCombatArgsSchema = z.object({})
export type EndCombatArgs = z.infer<typeof EndCombatArgsSchema>

export const EndTurnArgsSchema = z.object({
  creatureId: z.string(),
})
export type EndTurnArgs = z.infer<typeof EndTurnArgsSchema>

export const ApplyHealingPotionArgsSchema = z.object({
  targetId: z.string(),
  userId: z.string(),
  potionId: z.string(),
})
export type ApplyHealingPotionArgs = z.infer<typeof ApplyHealingPotionArgsSchema>

export const TransferItemsArgsSchema = z.object({
  sourceId: z.string(),
  targetId: z.string(),
  itemIds: z.array(z.string()).default([]),
  moneyToTransfer: z.number().int().min(0).default(0),
})
export type TransferItemsArgs = z.infer<typeof TransferItemsArgsSchema>

export const ToolArgsSchemas = {
  roll_check: RollCheckArgsSchema,
  apply_damage: ApplyDamageArgsSchema,
  attack: AttackArgsSchema,
  death_save: DeathSaveArgsSchema,
  apply_heal: ApplyHealArgsSchema,
  start_combat: StartCombatArgsSchema,
  end_combat: EndCombatArgsSchema,
  end_turn: EndTurnArgsSchema,
  apply_healing_potion: ApplyHealingPotionArgsSchema,
  transfer_items: TransferItemsArgsSchema,
} satisfies Record<ToolName, z.ZodType>
