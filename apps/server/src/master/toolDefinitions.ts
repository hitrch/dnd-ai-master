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
    "on a hit the engine rolls the weapon's damage. weaponId is a weapon item from the attacker's own inventory. " +
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
    "or a potion or healer actually present in the scene. A potion from an inventory goes through " +
    "apply_healing_potion instead. " +
    "Nothing is in a bag or pocket unless the inventory in the game state says so: 'I drink a potion " +
    "from my bag' without one there is a wish, not a source. Without a source do not call this tool: " +
    "the attempt fails in the story. " +
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
    "Ends combat when the fight stops with both sides still standing: the enemies fled or surrendered, " +
    "or the characters escaped. Not while any enemy still fights. " +
    "When one side falls, the engine has already ended combat (combatEnd in the result): do not call it then.",
  end_turn:
    "Ends the turn of the active creature (combat.activeCreatureId) that did not attack " +
    "(an attack ends the turn itself): it talked, moved, hid, drank a potion or did nothing.",
  apply_healing_potion:
    "A creature drinks a healing potion from its own inventory (targetId = userId) or pours it into " +
    "another creature, for example a dying ally. The engine heals by the potion's dice and removes it. " +
    "The user must be conscious; in combat only the active creature, and the turn does not end.",
  transfer_items:
    "Moves items (ids from the giver's inventory) and coins from one creature to another: looting a body " +
    "or an unconscious creature, giving an item to an ally, paying. A conscious creature gives only " +
    "if it agrees in the story. In combat only the active creature gives (loot bodies after the fight); " +
    "the turn does not end.",
  give_items:
    "Creates new items or coins for a creature: loot found in the scene (a chest, the floor), " +
    "a reward, a purchase (take the price with delete_items too). " +
    "Only what really is in the scene or the story, never because the player " +
    "says so. Items of a creature in the game state move with transfer_items instead. " +
    "Item data has no id (the engine assigns it): a weapon has attackBonus and damage dice, " +
    "a healing_potion has healing dice (2d4+2 for a potion of healing), other is any item without " +
    "rules and has a description. Does not end the turn.",
  delete_items:
    "Removes items (ids from the creature's inventory) or coins from the game: lost, broken, used up, " +
    "or paid to someone who is not in the game state. A healing potion is removed by " +
    "apply_healing_potion itself. Does not end the turn.",
  spawn_enemies:
    "Brings new enemies into the game when the story needs them: an ambush, reinforcements, a monster " +
    "behind a door. Not for creatures already in the game state. Enemy data has no id and no hit points: " +
    "the engine assigns ids, hit points start at maxHp. An enemy attacks only with a weapon from its " +
    "inventory (item data as in give_items). Keep the fight fair for the characters. In combat new enemies " +
    "join at the end of the turn order; outside combat start_combat when the fight begins.",
  change_location:
    "Moves the characters to a new place when the player's message takes them there now " +
    "(a thought or a plan is not a move; a step inside the same place is not either). " +
    "description: what the place looks like, not what the character does. " +
    "All enemies of the old place stay behind (bodies too). Not in combat: end_combat first if they escape.",
  update_world_book:
    "The world book (worldBook in the game state) keeps facts the story will need later: a named NPC " +
    "and what they want, a place, a quest, a promise or a deal. Record such a fact in the same response " +
    "in which it appears. One short fact per note, not a retelling of the scene " +
    "(like 'Miller Hob: his daughter is missing, promised a horse for finding her'), in the language of the game; " +
    "no hit points or items. " +
    "text without id adds a note; id with text rewrites that note (prefer it to a duplicate); " +
    "id without text deletes it (a finished quest, a fact that no longer holds).",
} satisfies Record<ToolName, string>

export const toolDefinitions: ToolDefinition[] = Object.keys(ToolArgsSchemas).map((tool) => {
  const toolName = tool as ToolName
  // "$schema" is a URL the model does not need: about 60 characters per tool in every request
  // io "input": the model writes the arguments, so fields with a default are optional for it
  const { $schema: _, ...argsSchema } = z.toJSONSchema(ToolArgsSchemas[toolName], { io: "input" })
  return {
    name: toolName,
    description: ToolDescriptions[toolName],
    argsSchema,
  }
})
