import { z } from "zod"


export const WeaponSchema = z.object({
  id: z.string(),
  name: z.string(),
  attackBonus: z.number().int().min(0).max(10),
  damage: z.object({
    diceCount: z.number().int().min(1).max(10),
    diceSides: z.literal([4, 6, 8, 10, 12, 20]),
    bonus: z.number().int().min(0).max(10),
  })
})
export type Weapon = z.infer<typeof WeaponSchema>

const CreatureSchema = z.object({
  id: z.string(),
  name: z.string(),
  hp: z.number().int(),
  maxHp: z.number().int().positive(),
  armorClass: z.number().int().positive(),
  weapons: z.array(WeaponSchema),
  // key - skill name, value - modifier
  skills: z.record(z.string(), z.number().int()),
})
export type Creature = z.infer<typeof CreatureSchema>

export const CharacterSchema = z.object({
  ...CreatureSchema.shape,
})
export type Character = z.infer<typeof CharacterSchema>

export const EnemySchema = z.object({
  ...CreatureSchema.shape,
})
export type Enemy = z.infer<typeof EnemySchema>

export const GameStateSchema = z.object({
  location: z.string(),
  players: z.array(CharacterSchema),
  enemies: z.array(EnemySchema),
})
export type GameState = z.infer<typeof GameStateSchema>
