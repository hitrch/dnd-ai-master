import { z } from "zod"

export const DiceSchema = z.object({
  diceCount: z.number().int().min(1).max(10),
  diceSides: z.literal([4, 6, 8, 10, 12, 20]),
  bonus: z.number().int().min(0).max(10),
})
export type Dice = z.infer<typeof DiceSchema>

const BaseItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  quantity: z.literal(1),
})

export const PotionSchema = z.object({
  ...BaseItemSchema.shape,
  kind: z.literal("potion"),
})
export type Potion = z.infer<typeof PotionSchema>

export const WeaponSchema = z.object({
  ...BaseItemSchema.shape,
  kind: z.literal("weapon"),
  attackBonus: z.number().int().min(0).max(10),
  damage: DiceSchema,
})
export type Weapon = z.infer<typeof WeaponSchema>

export const ItemSchema = z.discriminatedUnion("kind", [PotionSchema, WeaponSchema])
export type Item = z.infer<typeof ItemSchema>

const CreatureSchema = z.object({
  id: z.string(),
  name: z.string(),
  hp: z.number().int(),
  maxHp: z.number().int().positive(),
  money: z.number().int().min(0),
  armorClass: z.number().int().positive(),
  inventory: z.array(ItemSchema),
  initiativeModifier: z.number().int().min(-5).max(10),
  // key - skill name, value - modifier
  skills: z.record(z.string(), z.number().int()),
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

export const GameStateSchema = z.object({
  location: z.string(),
  players: z.array(CharacterSchema),
  enemies: z.array(EnemySchema),
  combat: CombatSchema.nullable(),
})
export type GameState = z.infer<typeof GameStateSchema>
