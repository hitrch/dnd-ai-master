import { z } from "zod"

export const DiceSchema = z.object({
  diceCount: z.number().int().min(1).max(10),
  diceSides: z.literal([4, 6, 8, 10, 12, 20]),
  bonus: z.number().int().min(0).max(10),
})
export type Dice = z.infer<typeof DiceSchema>

export const OtherItemWithoutIdSchema = z.object({
  name: z.string(),
  kind: z.literal("other"),
  description: z.string(),
})
export type OtherItemWithoutId = z.infer<typeof OtherItemWithoutIdSchema>

export const OtherItemSchema = z.object({
  ...OtherItemWithoutIdSchema.shape,
  id: z.string(),
})
export type OtherItem = z.infer<typeof OtherItemSchema>

export const HealingPotionWithoutIdSchema = z.object({
  name: z.string(),
  kind: z.literal("healing_potion"),
  healing: DiceSchema,
})
export type HealingPotionWithoutId = z.infer<typeof HealingPotionWithoutIdSchema>

export const HealingPotionSchema = z.object({
  ...HealingPotionWithoutIdSchema.shape,
  id: z.string(),
})
export type HealingPotion = z.infer<typeof HealingPotionSchema>

export const WeaponWithoutIdSchema = z.object({
  name: z.string(),
  kind: z.literal("weapon"),
  attackBonus: z.number().int().min(0).max(10),
  damage: DiceSchema,
})
export type WeaponWithoutId = z.infer<typeof WeaponWithoutIdSchema>

export const WeaponSchema = z.object({
  ...WeaponWithoutIdSchema.shape,
  id: z.string(),
})
export type Weapon = z.infer<typeof WeaponSchema>

export const ItemWithoutIdSchema = z.discriminatedUnion("kind", [
  HealingPotionWithoutIdSchema,
  WeaponWithoutIdSchema,
  OtherItemWithoutIdSchema,
])
export type ItemWithoutId = z.infer<typeof ItemWithoutIdSchema>

export const ItemSchema = z.discriminatedUnion("kind", [
  HealingPotionSchema,
  WeaponSchema,
  OtherItemSchema,
])
export type Item = z.infer<typeof ItemSchema>

const CreatureSchema = z.object({
  id: z.string(),
  name: z.string(),
  hp: z.number().int(),
  maxHp: z.number().int().positive().max(200),
  money: z.number().int().min(0),
  armorClass: z.number().int().positive().max(25),
  inventory: z.array(ItemSchema),
  initiativeModifier: z.number().int().min(-5).max(10),
  // key - skill name, value - modifier
  skills: z.record(z.string(), z.number().int().min(-5).max(15)),
})
export type Creature = z.infer<typeof CreatureSchema>

export const CharacterSchema = z.object({
  ...CreatureSchema.shape,
  saveRollFails: z.number().int().min(0).max(3),
  saveRollSuccesses: z.number().int().min(0).max(3),
  isStabilizedAfterSave: z.boolean(),
})
export type Character = z.infer<typeof CharacterSchema>

export const EnemySchema = z.object({
  ...CreatureSchema.shape,
})
export type Enemy = z.infer<typeof EnemySchema>

export const CombatSchema = z.object({
  order: z.array(z.string()).min(1),
  round: z.number().int().min(1),
  activeCreatureId: z.string(),
})
export type Combat = z.infer<typeof CombatSchema>

export function getItemsIdsFromState(state: GameState): string[] {
  return [...state.players, ...state.enemies].flatMap((c) => c.inventory).map((i) => i.id)
}

export const GameStateSchema = z
  .object({
    location: z.string(),
    players: z.array(CharacterSchema),
    enemies: z.array(EnemySchema),
    combat: CombatSchema.nullable(),
  })
  .refine(
    (data) => {
      const creaturesItemsIds = getItemsIdsFromState(data)
      const uniqueItemsIds = new Set(creaturesItemsIds)
      return uniqueItemsIds.size === creaturesItemsIds.length
    },
    { message: "Duplicate item ids" },
  )
export type GameState = z.infer<typeof GameStateSchema>
