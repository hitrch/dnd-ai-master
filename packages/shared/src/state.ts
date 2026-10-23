import { z } from "zod";

export const CharacterSchema = z.object({
  id: z.string(),
  name: z.string(),
  hp: z.number().int(),
  maxHp: z.number().int().positive(),
  // key - skill name, value - modifier
  skills: z.record(z.string(), z.number().int()),
});
export type Character = z.infer<typeof CharacterSchema>;

export const EnemySchema = z.object({
  id: z.string(),
  name: z.string(),
  hp: z.number().int(),
  maxHp: z.number().int().positive(),
});
export type Enemy = z.infer<typeof EnemySchema>;

export const GameStateSchema = z.object({
  location: z.string(),
  players: z.array(CharacterSchema),
  enemies: z.array(EnemySchema),
});
export type GameState = z.infer<typeof GameStateSchema>;