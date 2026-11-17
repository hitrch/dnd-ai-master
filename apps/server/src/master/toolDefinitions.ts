import type { ToolName } from "@dnd/shared"
import { ToolArgsSchemas } from "@dnd/shared"
import { z } from "zod"
import type { ToolDefinition } from "../model/types"

// Every description is sent with every model request, so keep them short.
// Rules shared by all tools (numbers come only from the engine, ids from the game state, turn order,
// narrate by the results, errors) live in the role prompt; results are self-describing JSON and are not retold here.

// How to read the damage part of a result, shared by attack and apply_damage
const damageOutcomeDescription =
  "Outcome: alive; down = a player character at 0 hit points, unconscious and dying (never narrate it as death); " +
  "dead = an enemy at 0 hit points or a killed character. " +
  "Hitting a down character adds a death save failure (two on a critical) and can kill them."

// Instructions for the model: what the tool does and when to call it
export const ToolDescriptions = {
  roll_check:
    "Rolls a d20 skill check for a player character against a difficulty class (DC). " +
    "Call it only when the outcome is uncertain and failure matters, not for trivial or impossible actions. " +
    "DC: 5 very easy, 10 easy, 15 medium, 20 hard, 25 very hard.",
  attack:
    "Weapon attack by a player character or an enemy: d20 + the weapon's attack bonus against the target's armor class; " +
    "on a hit the engine rolls the weapon's damage. Use one of the attacker's own weapons. " +
    "In combat only the active creature can attack, and any attack ends its turn. " +
    damageOutcomeDescription,
  apply_damage:
    "Damage without an attack roll: traps, falls, fire, poison and other hazards; never for a weapon attack. " +
    "Dice as D&D writes them: 2d6+3 is diceCount 2, diceSides 6, bonus 3. " +
    "For example 1d6 for a small fall, 2d6 for a fall from a tower floor; bonus 0 unless there is a clear reason. " +
    damageOutcomeDescription,
  death_save:
    "Death saving throw for a player character at 0 hit points who is still dying (not stable, not dead), " +
    "only outside combat: in combat the engine rolls it when the turn passes. " +
    "Call it instead of whatever the dying character tries to do.",
  apply_heal:
    "Restores hit points to a player character or an enemy. " +
    "Call it only when a real source exists: a spell or ability listed for the creature in the game state, " +
    "or a potion or healer actually present in the scene. " +
    "Nothing is in a bag or pocket unless the game state says so: 'I drink a potion from my bag' is a wish, " +
    "not a source. Without a source do not call this tool: the attempt fails in the story. " +
    "Dice: 2d4+2 for a potion of healing, 1d8+2 for a healing touch, 1d4+2 for a healing word. " +
    "Outcome healed, or regainedConsciousness: a character at 0 hit points wakes up and can act again " +
    "(not a resurrection: the dead cannot be healed).",
  start_combat:
    "Starts combat and rolls initiative. Call it once, when a fight breaks out (someone attacks, or hostile creatures " +
    "move against the characters), in the same response and before the first attack; not for threats or tense talk. " +
    "participantIds: the player characters in the scene (a dying one too) and only the enemies that fight right now. " +
    "Leave out enemies that are asleep, unaware or elsewhere, even if they are in the game state: " +
    "they are not in this fight. " +
    "Equal initiative keeps the order of participantIds.",
  end_combat:
    "Ends combat when the fight is over: every enemy in it is dead, has fled or has surrendered, " +
    "or the characters have escaped. Not while any enemy still fights. " +
    "Call it in the same response in which the last enemy falls.",
  end_turn:
    "Ends the turn of the active creature (combat.activeCreatureId) that did not attack " +
    "(an attack ends the turn itself): it talked, moved, hid or did nothing.",
} satisfies Record<ToolName, string>

export const toolDefinitions: ToolDefinition[] = Object.keys(ToolArgsSchemas).map((tool) => {
  const toolName = tool as ToolName
  // "$schema" is a URL the model does not need: about 60 characters per tool in every request
  const { $schema: _, ...argsSchema } = z.toJSONSchema(ToolArgsSchemas[toolName])
  return {
    name: toolName,
    description: ToolDescriptions[toolName],
    argsSchema,
  }
})
