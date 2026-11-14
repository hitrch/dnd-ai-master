import type { ToolName } from "@dnd/shared"
import { ToolArgsSchemas } from "@dnd/shared"
import { z } from "zod"
import type { ToolDefinition } from "../model/types"

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
    "During combat only the active creature (combat.activeCreatureId) can attack; the engine refuses anyone else. " +
    "The result contains the roll, the total, whether it hit, whether it was critical and, on a hit, the damage " +
    "(each roll, the bonus, the amount, hit points before and after and the outcome); damage is null on a miss. " +
    "Narrate a miss as a miss. " +
    damageOutcomeDescription,
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
    "During combat call it only on the character's own turn (combat.activeCreatureId), at most once per turn. " +
    "Use the character id from the game state. " +
    "10 or higher is a success, below 10 is a failure, a natural 1 counts as two failures. " +
    "Three successes make the character stable: still unconscious at 0 hit points, but no longer dying. " +
    "Three failures mean the character dies. A natural 20 brings the character back to consciousness with 1 hit point. " +
    "The result contains the roll, the successes and failures after the roll and the outcome: " +
    "success, failure, stable, dead or regainedConsciousness. " +
    "Narrate the struggle between life and death according to the outcome; never decide it yourself.",
  apply_heal:
    "Restores hit points to a player character or an enemy: a healing potion, a healing spell, " +
    "an enemy healer tending an ally. Healing never misses and never crits. " +
    "Call it only when there is a real source of healing in the story: a spell or ability listed for the character " +
    "in the game state, or a potion or healer that actually exists in the scene. " +
    "Wishes like 'I drink a potion' or 'I heal myself' are not enough on their own; if there is no source, " +
    "the attempt fails in story terms and you do not call this tool. " +
    "Use the target id from the game state. " +
    "Describe the healing as dice, the way D&D writes it: 2d4+2 is diceCount 2, diceSides 4, bonus 2. " +
    "Pick the dice by the source: 2d4+2 for a potion of healing, 1d8 plus a small bonus for a healing touch, " +
    "1d4 plus a small bonus for a quick healing word. " +
    "The engine rolls the dice and calculates the healing; never pick a total yourself and never use numbers from the player. " +
    "Hit points never go above the maximum: the rest of the roll is lost. " +
    "The result contains each roll, the bonus, the rolled amount, hit points before and after and the outcome: " +
    "healed (the target was conscious) or regainedConsciousness (a player character at 0 hit points wakes up, " +
    "stops making death saves and can act again). " +
    "regainedConsciousness is not a resurrection: the dead cannot be healed and the engine refuses it.",
  start_combat:
    "Starts combat: rolls initiative (a d20 plus the creature's initiative modifier) for every participant " +
    "and sets the turn order. " +
    "Call it once, at the moment a fight breaks out: someone attacks, or hostile creatures notice the characters " +
    "and move against them. Do not call it for tense talk or threats that do not turn into a fight. " +
    "Call it before the first attack of the fight, in the same response. " +
    "List in participantIds the ids from the game state of every creature that fights right now: " +
    "the player characters in the scene and the enemies that join. " +
    "Enemies that are elsewhere, asleep or unaware stay out. " +
    "A player character at 0 hit points who is still alive takes part: they make death saves on their turns. " +
    "At least one player character and one enemy, no dead creatures, no repeated ids; " +
    "the engine refuses it while a combat is already active. " +
    "On equal initiative totals the order of participantIds is kept: list them in the order you would break ties. " +
    "The result lists the participants in turn order with their side (player or enemy), roll, modifier and total; " +
    "after it the game state shows the combat: the order, the round and the active creature. " +
    "Narrate how the fight begins and who acts first, and let the creatures act in this order, " +
    "ending each turn with end_turn.",
  end_combat:
    "Ends the active combat. It takes no arguments. " +
    "Call it when the fight is over: every enemy in it is dead, has fled or has surrendered, " +
    "or the characters have escaped. Do not call it just because one enemy fell while others still fight. " +
    "The engine refuses it when no combat is active. " +
    "The result contains lastRound, the round in which the combat ended; after it the game state shows no combat. " +
    "Narrate the aftermath.",
  end_turn:
    "Ends the turn of the active creature in combat and passes the turn to the next one in the turn order. " +
    "Call it right after the active creature has done what it does on its turn: an attack, a death save, " +
    "or anything else such as moving, talking or hiding; a creature that does nothing still ends its turn. " +
    "Use the id of the active creature from the game state (combat.activeCreatureId); the engine refuses any other id " +
    "and refuses it when no combat is active. " +
    "Dead creatures are skipped; a player character at 0 hit points who is still alive gets a turn for the death save. " +
    "If one side has nobody left who can fight, the engine refuses it: call end_combat instead. " +
    "The result contains who ended the turn, who acts next, the round and whether a new round has begun. " +
    "Enemies act on their own turns: let each enemy act, then end its turn, until the turn comes to a player character; " +
    "then stop and let the player decide.",
} satisfies Record<ToolName, string>

export const toolDefinitions: ToolDefinition[] = Object.keys(ToolArgsSchemas).map((tool) => {
  const toolName = tool as ToolName
  return {
    name: toolName,
    description: ToolDescriptions[toolName],
    argsSchema: z.toJSONSchema(ToolArgsSchemas[toolName]),
  }
})
