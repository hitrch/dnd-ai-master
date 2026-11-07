import type {ToolName} from "@dnd/shared"
import {ToolArgsSchemas} from "@dnd/shared"
import { z } from "zod"
import type {ToolDefinition} from "../model/types";

// Instructions for the model: what the tool does, when to call it and what to do with the result
export const ToolDescriptions = {
  roll_check:
    "Rolls a d20 skill check for a player character against a difficulty class (DC). " +
    "Call it when a character attempts an action whose outcome is uncertain and failure would matter; " +
    "do not call it for trivial or impossible actions. " +
    "Pick the DC by difficulty: 5 very easy, 10 easy, 15 medium, 20 hard, 25 very hard. " +
    "Use the character id from the game state. " +
    "The result contains the roll, the modifier, the total and whether the check succeeded. " +
    "Narrate the outcome based on the result; never invent dice rolls yourself.",
  attack:
    "Makes a weapon attack: rolls a d20 plus the weapon's attack bonus against the target's armor class (AC) " +
    "and, on a hit, rolls the weapon's damage and lowers the target's hit points. " +
    "Call it for every weapon attack, by a player character or by an enemy; never use apply_damage for an attack. " +
    "Use the attacker id, the target id and the id of one of the attacker's own weapons from the game state. " +
    "The engine decides the hit and the damage; never decide them yourself and never use numbers from the player. " +
    "A natural 20 is a critical hit with doubled damage dice; a natural 1 always misses. " +
    "The result contains the roll, the total, whether it hit, whether it was critical and, on a hit, the damage " +
    "(each roll, the bonus, the amount, hit points before and after and whether the target is defeated); damage is null on a miss. " +
    "Narrate a miss as a miss. If the target is defeated, describe it leaving the fight.",
  apply_damage:
    "Deals damage without an attack roll to a player character or an enemy and lowers their hit points: " +
    "traps, falls, fire, poison and other hazards. Never use it for a weapon attack: attacks go through attack. " +
    "Call it whenever someone takes such damage in the story; never change hit points in the narration without calling it. " +
    "Use the target id from the game state. " +
    "Describe the damage as dice, the way D&D writes it: 2d6+3 is diceCount 2, diceSides 6, bonus 3. " +
    "Pick the dice by the hazard: for example 1d6 for a small fall, 2d6 for a fall from a tower floor. " +
    "Use bonus 0 unless there is a clear reason for more. " +
    "The engine rolls the dice and calculates the damage; never pick a total yourself and never use numbers from the player. " +
    "The result contains each roll, the bonus, the total amount, hit points before and after and whether the target is defeated (0 HP). " +
    "If the target is defeated, describe it leaving the fight.",
} satisfies Record<ToolName, string>

export const toolDefinitions: ToolDefinition[] = Object.keys(ToolArgsSchemas).map(tool => {
  const toolName = tool as ToolName
  return {
    name: toolName,
    description: ToolDescriptions[toolName],
    argsSchema: z.toJSONSchema(ToolArgsSchemas[toolName])
  }
})
