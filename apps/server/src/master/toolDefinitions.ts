import type {ToolName} from "@dnd/shared"
import {ToolArgsSchemas} from "@dnd/shared"
import { z } from "zod"
import type {ToolDefinition} from "../model/types";

// How to read the damage part of a result, shared by attack and apply_damage
const damageOutcomeDescription =
  "The damage outcome is alive (still standing), down (a player character at 0 hit points, unconscious and dying) " +
  "or dead (an enemy at 0 hit points, or a player character killed). " +
  "A player character at 0 hit points can still be hit: each hit adds a death save failure, a critical hit adds two, " +
  "and damage equal to the character's maximum hit points kills them at once; damage also ends stability. " +
  "The engine refuses damage to a dead character or to an enemy already at 0 hit points. " +
  "Narrate down as falling unconscious, never as death; narrate dead only when the outcome says so."

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
    "(each roll, the bonus, the amount, hit points before and after and the outcome); damage is null on a miss. " +
    "Narrate a miss as a miss. " + damageOutcomeDescription,
  apply_damage:
    "Deals damage without an attack roll to a player character or an enemy and lowers their hit points: " +
    "traps, falls, fire, poison and other hazards. Never use it for a weapon attack: attacks go through attack. " +
    "Call it whenever someone takes such damage in the story; never change hit points in the narration without calling it. " +
    "Use the target id from the game state. " +
    "Describe the damage as dice, the way D&D writes it: 2d6+3 is diceCount 2, diceSides 6, bonus 3. " +
    "Pick the dice by the hazard: for example 1d6 for a small fall, 2d6 for a fall from a tower floor. " +
    "Use bonus 0 unless there is a clear reason for more. " +
    "The engine rolls the dice and calculates the damage; never pick a total yourself and never use numbers from the player. " +
    "The result contains each roll, the bonus, the total amount, hit points before and after and the outcome. " +
    damageOutcomeDescription,
  death_save:
    "Rolls a death saving throw for a player character at 0 hit points: a plain d20 with no modifiers. " +
    "Call it once each time the dying character would act, instead of any action of theirs: " +
    "a character at 0 hit points cannot move, talk, attack or make checks. " +
    "Do not call it for a character who is stable or dead; the engine refuses it. " +
    "Use the character id from the game state. " +
    "10 or higher is a success, below 10 is a failure, a natural 1 counts as two failures. " +
    "Three successes make the character stable: still unconscious at 0 hit points, but no longer dying. " +
    "Three failures mean the character dies. A natural 20 brings the character back to consciousness with 1 hit point. " +
    "The result contains the roll, the successes and failures after the roll and the outcome: " +
    "success, failure, stable, dead or revived. " +
    "Narrate the struggle between life and death according to the outcome; never decide it yourself.",
} satisfies Record<ToolName, string>

export const toolDefinitions: ToolDefinition[] = Object.keys(ToolArgsSchemas).map(tool => {
  const toolName = tool as ToolName
  return {
    name: toolName,
    description: ToolDescriptions[toolName],
    argsSchema: z.toJSONSchema(ToolArgsSchemas[toolName])
  }
})
