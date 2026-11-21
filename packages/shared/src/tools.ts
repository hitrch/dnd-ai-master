import { z } from "zod"
import { SkillSchema } from "./skills"
import type { ToolName } from "./types"
import {
  DiceSchema,
  EnemySchema,
  ItemWithoutIdSchema,
  LocationSchema,
  NoteWithoutIdSchema,
} from "./state"

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

export const DeleteItemsArgsSchema = z.object({
  targetId: z.string(),
  itemIds: z.array(z.string()).default([]),
  moneyToTake: z.number().int().min(0).default(0),
})
export type DeleteItemsArgs = z.infer<typeof DeleteItemsArgsSchema>

export const GiveItemsArgsSchema = z.object({
  targetId: z.string(),
  items: z.array(ItemWithoutIdSchema).default([]),
  moneyToGive: z.number().int().min(0).default(0),
})
export type GiveItemsArgs = z.infer<typeof GiveItemsArgsSchema>

export const SpawnEnemiesArgsSchema = z.object({
  enemies: z
    .array(
      z.object({
        ...EnemySchema.omit({ id: true, hp: true }).shape,
        inventory: z.array(ItemWithoutIdSchema).default([]),
      }),
    )
    .min(1),
})
export type SpawnEnemiesArgs = z.infer<typeof SpawnEnemiesArgsSchema>

export const ChangeLocationArgsSchema = LocationSchema
export type ChangeLocationArgs = z.infer<typeof ChangeLocationArgsSchema>

export const UpdateWorldBookArgsSchema = z.object({
  ...NoteWithoutIdSchema.partial().shape,
  id: z.string().optional(),
})
export type UpdateWorldBookArgs = z.infer<typeof UpdateWorldBookArgsSchema>

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
  delete_items: DeleteItemsArgsSchema,
  give_items: GiveItemsArgsSchema,
  spawn_enemies: SpawnEnemiesArgsSchema,
  change_location: ChangeLocationArgsSchema,
  update_world_book: UpdateWorldBookArgsSchema,
} satisfies Record<ToolName, z.ZodType>
