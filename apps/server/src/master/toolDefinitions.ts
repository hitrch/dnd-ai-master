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
  apply_damage:
    "Deals damage to a player character or an enemy and lowers their hit points. " +
    "Call it whenever someone takes damage in the story; never change hit points in the narration without calling it. " +
    "Use the target id from the game state and a positive whole amount. " +
    "The result contains hit points before and after and whether the target is defeated (0 HP). " +
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
