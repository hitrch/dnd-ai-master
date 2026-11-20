import { test } from "node:test"
import type { TestContext } from "node:test"
import assert from "node:assert/strict"
import { GameStateSchema } from "@dnd/shared"
import type { GameState } from "@dnd/shared"
import { compactHistory, executeTools, Master, splitHistoryForSummary } from "./master"
import { modelDefinition } from "./modelDefinition"
import { toolDefinitions } from "./toolDefinitions"
import type { ModelProvider, ModelResponse, StoryMessage, ToolDefinition } from "../model/types"
import type { ActionStore, ToolResult } from "../types"

const state = GameStateSchema.parse({
  location: "Подножие башни",
  players: [
    {
      id: "p1",
      name: "Арвен",
      hp: 12,
      maxHp: 12,
      armorClass: 14,
      money: 10,
      inventory: [
        {
          kind: "weapon",
          id: "dagger",
          name: "Кинжал",
          attackBonus: 5,
          damage: { diceCount: 1, diceSides: 4, bonus: 3 },
        },
      ],
      skills: { stealth: 5, athletics: 1 },
      initiativeModifier: 3,
      saveRollFails: 0,
      saveRollSuccesses: 0,
      isStabilizedAfterSave: false,
    },
  ],
  enemies: [
    {
      id: "e1",
      name: "Гоблин-часовой",
      hp: 7,
      maxHp: 7,
      armorClass: 15,
      money: 0,
      inventory: [],
      skills: {},
      initiativeModifier: 2,
    },
  ],
  combat: null,
})

// rng = 0 rolls 1 on the die, 0.5 rolls 11, 0.999 rolls 20
const fixed = (v: number) => () => v

// 1d4 with rng = 0.5 deals 3 damage
const d4 = { diceCount: 1, diceSides: 4, bonus: 0 }

// Asserts that the result is a failure and returns its error text
function failureText(r: ToolResult | undefined, tool: string): string {
  assert.ok(r, "no result")
  assert.ok(!r.isOk, "expected a failed result")
  assert.equal(r.tool, tool)
  return r.errorText
}

test("empty list returns the same state and no results", () => {
  const r = executeTools([], state, fixed(0.5))
  assert.equal(r.state, state)
  assert.deepEqual(r.results, [])
})

test("results follow the order of calls", () => {
  const r = executeTools(
    [
      { name: "roll_check", args: { characterId: "p1", skill: "stealth", dc: 10 } },
      { name: "apply_damage", args: { targetId: "e1", ...d4 } },
    ],
    state,
    fixed(0.5),
  )
  assert.deepEqual(
    r.results.map((res) => res.tool),
    ["roll_check", "apply_damage"],
  )
  assert.ok(r.results.every((res) => res.isOk))
})

test("result contains parsed args and the engine event", () => {
  const r = executeTools(
    [{ name: "apply_damage", args: { targetId: "e1", ...d4 } }],
    state,
    fixed(0.5),
  )
  const rec = r.results[0]
  assert.ok(rec.isOk && rec.tool === "apply_damage")
  assert.deepEqual(rec.args, { targetId: "e1", ...d4 })
  assert.equal(rec.event.damage.hpBefore, 7)
  assert.equal(rec.event.damage.hpAfter, 4)
})

test("attack call is executed by the engine and recorded", () => {
  // d20 = 11, 11 + 5 = 16 vs AC 15; d4 = 3, 3 + 3 = 6
  const args = { attackerId: "p1", weaponId: "dagger", targetId: "e1" }
  const r = executeTools([{ name: "attack", args }], state, fixed(0.5))
  const rec = r.results[0]
  assert.ok(rec.isOk && rec.tool === "attack")
  assert.deepEqual(rec.args, args)
  assert.equal(rec.event.hasHit, true)
  assert.equal(rec.event.damage?.hpAfter, 1)
  assert.equal(r.state.enemies[0].hp, 1)
})

test("death_save call is executed by the engine and recorded", () => {
  // d20 = 11: a success
  const down = { ...state, players: [{ ...state.players[0], hp: 0 }] }
  const r = executeTools([{ name: "death_save", args: { characterId: "p1" } }], down, fixed(0.5))
  const rec = r.results[0]
  assert.ok(rec.isOk && rec.tool === "death_save")
  assert.deepEqual(rec.args, { characterId: "p1" })
  assert.equal(rec.event.outcome, "success")
  assert.equal(r.state.players[0].saveRollSuccesses, 1)
})

test("death_save refused by the engine returns a failed result", () => {
  // the character is not down
  const r = executeTools([{ name: "death_save", args: { characterId: "p1" } }], state, fixed(0.5))
  assert.ok(failureText(r.results[0], "death_save").length > 0)
  assert.equal(r.state, state)
})

test("death_save is described to the model", () => {
  const definition = toolDefinitions.find((d) => d.name === "death_save")
  assert.ok(definition)
  assert.ok(definition.description.length > 0)
})

test("apply_heal call is executed by the engine and recorded", () => {
  // 1d4 = 3: from 0 HP to 3
  const down = { ...state, players: [{ ...state.players[0], hp: 0, saveRollFails: 2 }] }
  const args = { targetId: "p1", ...d4 }
  const r = executeTools([{ name: "apply_heal", args }], down, fixed(0.5))
  const rec = r.results[0]
  assert.ok(rec.isOk && rec.tool === "apply_heal")
  assert.deepEqual(rec.args, args)
  assert.equal(rec.event.hpAfter, 3)
  assert.equal(rec.event.outcome, "regainedConsciousness")
  assert.equal(r.state.players[0].hp, 3)
  assert.equal(r.state.players[0].saveRollFails, 0)
})

test("apply_healing_potion call is executed by the engine and recorded", () => {
  // 1d4 = 3: from 2 HP to 5, the potion is gone
  const potion = {
    kind: "healing_potion" as const,
    id: "potion",
    name: "Зелье лечения",
    healing: { diceCount: 1, diceSides: 4 as const, bonus: 0 },
  }
  const player = state.players[0]
  const wounded = {
    ...state,
    players: [{ ...player, hp: 2, inventory: [...player.inventory, potion] }],
  }
  const args = { userId: "p1", potionId: "potion", targetId: "p1" }
  const r = executeTools([{ name: "apply_healing_potion", args }], wounded, fixed(0.5))
  const rec = r.results[0]
  assert.ok(rec.isOk && rec.tool === "apply_healing_potion")
  assert.deepEqual(rec.args, args)
  assert.equal(rec.event.potionName, "Зелье лечения")
  assert.equal(r.state.players[0].hp, 5)
  assert.deepEqual(r.state.players[0].inventory, player.inventory)
})

test("apply_healing_potion refused by the engine returns a failed result", () => {
  // the dagger is not a potion
  const args = { userId: "p1", potionId: "dagger", targetId: "p1" }
  const r = executeTools([{ name: "apply_healing_potion", args }], state, fixed(0.5))
  failureText(r.results[0], "apply_healing_potion")
  assert.equal(r.state, state)
})

test("transfer_items call is executed by the engine and recorded with default args", () => {
  // Арвен gives her dagger to the goblin; no coins in the call, the schema fills in 0
  const args = { sourceId: "p1", targetId: "e1", itemIds: ["dagger"] }
  const r = executeTools([{ name: "transfer_items", args }], state, fixed(0.5))
  const rec = r.results[0]
  assert.ok(rec.isOk && rec.tool === "transfer_items")
  assert.deepEqual(rec.args, { ...args, moneyToTransfer: 0 })
  assert.deepEqual(rec.event.itemsTransferred, [{ id: "dagger", name: "Кинжал" }])
  assert.deepEqual(r.state.players[0].inventory, [])
  assert.deepEqual(r.state.enemies[0].inventory, state.players[0].inventory)
})

test("transfer_items refused by the engine returns a failed result", () => {
  const args = { sourceId: "p1", targetId: "p1", itemIds: ["dagger"] }
  const r = executeTools([{ name: "transfer_items", args }], state, fixed(0.5))
  failureText(r.results[0], "transfer_items")
  assert.equal(r.state, state)
})

test("delete_items call is executed by the engine and recorded with default args", () => {
  // the dagger breaks; no coins in the call, the schema fills in 0
  const args = { targetId: "p1", itemIds: ["dagger"] }
  const r = executeTools([{ name: "delete_items", args }], state, fixed(0.5))
  const rec = r.results[0]
  assert.ok(rec.isOk && rec.tool === "delete_items")
  assert.deepEqual(rec.args, { ...args, moneyToTake: 0 })
  assert.deepEqual(rec.event.deletedItems, [{ id: "dagger", name: "Кинжал" }])
  assert.deepEqual(r.state.players[0].inventory, [])
})

test("delete_items refused by the engine returns a failed result", () => {
  const args = { targetId: "p1", itemIds: ["bow"] }
  const r = executeTools([{ name: "delete_items", args }], state, fixed(0.5))
  failureText(r.results[0], "delete_items")
  assert.equal(r.state, state)
})

test("give_items call drops an id sent by the model, the engine assigns its own", () => {
  const rope = {
    kind: "other",
    id: "dagger",
    name: "Верёвка",
    description: "Пятьдесят футов",
  }
  const r = executeTools(
    [{ name: "give_items", args: { targetId: "p1", items: [rope] } }],
    state,
    fixed(0.5),
  )
  const rec = r.results[0]
  assert.ok(rec.isOk && rec.tool === "give_items")
  assert.deepEqual(rec.event.itemsGiven, [{ id: "item-1", name: "Верёвка" }])
  assert.equal(rec.event.moneyGiven, 0)
  assert.deepEqual(
    r.state.players[0].inventory.map((i) => i.id),
    ["dagger", "item-1"],
  )
  assert.equal(GameStateSchema.safeParse(r.state).success, true)
})

test("give_items with an item that does not fit its kind returns a failed result", () => {
  // a weapon without damage dice
  const sword = { kind: "weapon", name: "Меч", attackBonus: 5 }
  const r = executeTools(
    [{ name: "give_items", args: { targetId: "p1", items: [sword] } }],
    state,
    fixed(0.5),
  )
  failureText(r.results[0], "give_items")
  assert.equal(r.state, state)
})

test("spawn_enemies call is executed by the engine and recorded with default args", () => {
  // no inventory in the call, the schema fills in an empty one
  const wolf = {
    name: "Волк",
    maxHp: 11,
    money: 0,
    armorClass: 13,
    initiativeModifier: 2,
    skills: {},
  }
  const r = executeTools([{ name: "spawn_enemies", args: { enemies: [wolf] } }], state, fixed(0.5))
  const rec = r.results[0]
  assert.ok(rec.isOk && rec.tool === "spawn_enemies")
  assert.deepEqual(rec.args, { enemies: [{ ...wolf, inventory: [] }] })
  assert.deepEqual(rec.event, {
    enemies: [{ id: "enemy-1", name: "Волк" }],
    hasEnteredCombat: false,
  })
  assert.equal(r.state.enemies.at(-1)?.hp, 11)
})

test("spawn_enemies with numbers out of bounds returns a failed result", () => {
  const giant = {
    name: "Великан",
    maxHp: 5000,
    money: 0,
    armorClass: 30,
    initiativeModifier: 0,
    skills: {},
  }
  const r = executeTools([{ name: "spawn_enemies", args: { enemies: [giant] } }], state, fixed(0.5))
  failureText(r.results[0], "spawn_enemies")
  assert.equal(r.state, state)
})

test("start_combat call is executed by the engine and recorded", () => {
  // p1 11+3=14, e1 11+2=13
  const args = { participantIds: ["e1", "p1"] }
  const r = executeTools([{ name: "start_combat", args }], state, fixed(0.5))
  const rec = r.results[0]
  assert.ok(rec.isOk && rec.tool === "start_combat")
  assert.deepEqual(rec.args, args)
  assert.deepEqual(
    rec.event.participantsOrder.map((p) => p.id),
    ["p1", "e1"],
  )
  assert.deepEqual(r.state.combat, { order: ["p1", "e1"], round: 1, activeCreatureId: "p1" })
})

test("start_combat refused by the engine returns a failed result", () => {
  // a repeated id passes the schema but not the engine
  const r = executeTools(
    [{ name: "start_combat", args: { participantIds: ["e1", "e1"] } }],
    state,
    fixed(0.5),
  )
  failureText(r.results[0], "start_combat")
  assert.equal(r.state.combat, null)
})

test("end_combat call is executed by the engine and recorded, extra args are dropped", () => {
  const fighting = { ...state, combat: { order: ["p1", "e1"], round: 2, activeCreatureId: "p1" } }
  const r = executeTools([{ name: "end_combat", args: { reason: "fled" } }], fighting, fixed(0.5))
  const rec = r.results[0]
  assert.ok(rec.isOk && rec.tool === "end_combat")
  assert.deepEqual(rec.args, {})
  assert.deepEqual(rec.event, { lastRound: 2 })
  assert.equal(r.state.combat, null)
})

test("end_combat refused by the engine returns a failed result", () => {
  const r = executeTools([{ name: "end_combat", args: {} }], state, fixed(0.5))
  failureText(r.results[0], "end_combat")
})

test("start_combat then end_combat in one round of calls", () => {
  const r = executeTools(
    [
      { name: "start_combat", args: { participantIds: ["p1", "e1"] } },
      { name: "end_combat", args: {} },
    ],
    state,
    fixed(0.5),
  )
  assert.equal(r.state.combat, null)
  assert.deepEqual(
    r.results.map((res) => res.tool),
    ["start_combat", "end_combat"],
  )
})

test("end_turn call is executed by the engine and recorded", () => {
  const fighting = { ...state, combat: { order: ["p1", "e1"], round: 1, activeCreatureId: "p1" } }
  const r = executeTools([{ name: "end_turn", args: { creatureId: "p1" } }], fighting, fixed(0.5))
  const rec = r.results[0]
  assert.ok(rec.isOk && rec.tool === "end_turn")
  assert.deepEqual(rec.args, { creatureId: "p1" })
  assert.equal(rec.event.nextTurn?.nextCreatureId, "e1")
  assert.equal(r.state.combat?.activeCreatureId, "e1")
})

test("end_turn: rng reaches the automatic death save of a dying character", () => {
  // the goblin ends its turn, Arwen at 0 HP is next: her save rolls 20 with this rng
  const fighting = {
    ...state,
    players: state.players.map((p) => ({ ...p, hp: 0 })),
    combat: { order: ["p1", "e1"], round: 1, activeCreatureId: "e1" },
  }
  const r = executeTools([{ name: "end_turn", args: { creatureId: "e1" } }], fighting, fixed(0.999))
  const rec = r.results[0]
  assert.ok(rec.isOk && rec.tool === "end_turn")
  assert.equal(rec.event.saveEvents[0]?.roll, 20)
  assert.equal(r.state.players[0].hp, 1)
})

test("end_turn refused by the engine returns a failed result", () => {
  const r = executeTools([{ name: "end_turn", args: { creatureId: "p1" } }], state, fixed(0.5))
  failureText(r.results[0], "end_turn")
})

const scimitar = {
  kind: "weapon" as const,
  id: "scimitar",
  name: "Скимитар",
  attackBonus: 4,
  damage: { diceCount: 1, diceSides: 6 as const, bonus: 2 },
}

test("a full round in one batch: the attacks pass the turns themselves", () => {
  // every d20 rolls 11: 11 + 5 = 16 vs AC 15 and 11 + 4 = 15 vs AC 14, both attacks hit
  const fighting = {
    ...state,
    enemies: [{ ...state.enemies[0], inventory: [scimitar] }],
    combat: { order: ["p1", "e1"], round: 1, activeCreatureId: "p1" },
  }
  const r = executeTools(
    [
      { name: "attack", args: { attackerId: "p1", weaponId: "dagger", targetId: "e1" } },
      { name: "attack", args: { attackerId: "e1", weaponId: "scimitar", targetId: "p1" } },
    ],
    fighting,
    fixed(0.5),
  )
  assert.ok(r.results.every((res) => res.isOk))
  assert.deepEqual(r.state.combat, { order: ["p1", "e1"], round: 2, activeCreatureId: "p1" })
  assert.equal(r.state.enemies[0].hp, 1)
  assert.equal(r.state.players[0].hp, 6)
})

test("end_turn after an attack is refused: the attack has already passed the turn", () => {
  const fighting = { ...state, combat: { order: ["p1", "e1"], round: 1, activeCreatureId: "p1" } }
  const r = executeTools(
    [
      { name: "attack", args: { attackerId: "p1", weaponId: "dagger", targetId: "e1" } },
      { name: "end_turn", args: { creatureId: "p1" } },
    ],
    fighting,
    fixed(0.5),
  )
  assert.ok(r.results[0]?.isOk)
  failureText(r.results[1], "end_turn")
  // the attack stays applied: a refused call does not undo the ones before it
  assert.equal(r.state.combat?.activeCreatureId, "e1")
  assert.equal(r.state.enemies[0].hp, 1)
})

test("attack out of turn in combat returns a failed result naming the active creature", () => {
  const fighting = { ...state, combat: { order: ["p1", "e1"], round: 1, activeCreatureId: "e1" } }
  const r = executeTools(
    [{ name: "attack", args: { attackerId: "p1", weaponId: "dagger", targetId: "e1" } }],
    fighting,
    fixed(0.5),
  )
  assert.match(failureText(r.results[0], "attack"), /e1/)
  assert.equal(r.state.enemies[0].hp, 7)
})

test("combat tools are described to the model", () => {
  for (const name of ["start_combat", "end_combat", "end_turn"]) {
    const definition = toolDefinitions.find((d) => d.name === name)
    assert.ok(definition, name)
    assert.ok(definition.description.length > 0, name)
    assert.equal(definition.argsSchema.type, "object", name)
  }
})

test("apply_heal refused by the engine returns a failed result", () => {
  // the goblin at 0 HP is dead
  const deadGoblin = { ...state, enemies: [{ ...state.enemies[0], hp: 0 }] }
  const r = executeTools(
    [{ name: "apply_heal", args: { targetId: "e1", ...d4 } }],
    deadGoblin,
    fixed(0.5),
  )
  failureText(r.results[0], "apply_heal")
  assert.equal(r.state.enemies[0].hp, 0)
})

test("apply_heal is described to the model", () => {
  const definition = toolDefinitions.find((d) => d.name === "apply_heal")
  assert.ok(definition)
  assert.ok(definition.description.length > 0)
})

test("attack with an invalid args shape returns a failed result naming the field", () => {
  const r = executeTools(
    [{ name: "attack", args: { attackerId: "p1", targetId: "e1" } }],
    state,
    fixed(0.5),
  )
  assert.match(failureText(r.results[0], "attack"), /weaponId/)
  assert.equal(r.state, state)
})

test("attack refused by the engine returns its error text", () => {
  const args = { attackerId: "p1", weaponId: "scimitar", targetId: "e1" }
  const r = executeTools([{ name: "attack", args }], state, fixed(0.5))
  assert.match(failureText(r.results[0], "attack"), /scimitar/)
})

test("rng is passed to the engine", () => {
  const r = executeTools(
    [{ name: "roll_check", args: { characterId: "p1", skill: "stealth", dc: 25 } }],
    state,
    fixed(0.999),
  )
  const rec = r.results[0]
  assert.ok(rec.isOk && rec.tool === "roll_check")
  assert.equal(rec.event.roll, 20)
  assert.equal(rec.event.total, 25)
  assert.equal(rec.event.success, true)
})

test("each call sees the state produced by the previous one", () => {
  const r = executeTools(
    [
      { name: "apply_damage", args: { targetId: "e1", ...d4 } },
      { name: "apply_damage", args: { targetId: "e1", ...d4 } },
    ],
    state,
    fixed(0.5),
  )
  const second = r.results[1]
  assert.ok(second.isOk && second.tool === "apply_damage")
  assert.equal(second.event.damage.hpBefore, 4)
  assert.equal(second.event.damage.hpAfter, 1)
  assert.equal(r.state.enemies[0].hp, 1)
})

test("rng is passed to the engine for damage", () => {
  const r = executeTools(
    [{ name: "apply_damage", args: { targetId: "e1", diceCount: 1, diceSides: 6, bonus: 0 } }],
    state,
    fixed(0),
  )
  const rec = r.results[0]
  assert.ok(rec.isOk && rec.tool === "apply_damage")
  assert.deepEqual(rec.event.damage.rolls, [1])
  assert.equal(rec.event.damage.amount, 1)
})

test("damage tool schema shows the model the allowed dice", () => {
  const definition = toolDefinitions.find((t) => t.name === "apply_damage")
  assert.ok(definition)
  const properties = definition.argsSchema.properties as Record<string, { enum?: number[] }>
  assert.deepEqual(properties.diceSides.enum, [4, 6, 8, 10, 12, 20])
})

test("input state is not mutated", () => {
  executeTools([{ name: "apply_damage", args: { targetId: "e1", ...d4 } }], state, fixed(0.5))
  assert.equal(state.enemies[0].hp, 7)
})

test("unknown tool name returns a failed result that mentions the name", () => {
  const r = executeTools([{ name: "heal", args: {} }], state, fixed(0.5))
  assert.match(failureText(r.results[0], "heal"), /heal/)
})

test("inherited object property name is not accepted as a tool", () => {
  const r = executeTools([{ name: "toString", args: {} }], state, fixed(0.5))
  assert.match(failureText(r.results[0], "toString"), /toString/)
})

test("invalid args are rejected before the engine", () => {
  // dc above the schema limit; the rng would make the check succeed if the engine ran
  const check = executeTools(
    [{ name: "roll_check", args: { characterId: "p1", skill: "stealth", dc: 100 } }],
    state,
    fixed(0.999),
  )
  assert.match(failureText(check.results[0], "roll_check"), /dc/)

  const damage = executeTools(
    [{ name: "apply_damage", args: { targetId: "e1" } }],
    state,
    fixed(0.5),
  )
  failureText(damage.results[0], "apply_damage")
  assert.equal(damage.state, state)
})

test("engine error returns a failed result with the engine error text", () => {
  const r = executeTools(
    [{ name: "apply_damage", args: { targetId: "ghost", ...d4 } }],
    state,
    fixed(0.5),
  )
  assert.match(failureText(r.results[0], "apply_damage"), /ghost/)
  assert.equal(r.state, state)
})

// ---------- failure in a batch ----------

test("calls after a failed one are skipped, every call still gets a result", () => {
  const r = executeTools(
    [
      { name: "apply_damage", args: { targetId: "ghost", ...d4 } },
      { name: "apply_damage", args: { targetId: "e1", ...d4 } },
      { name: "roll_check", args: { characterId: "p1", skill: "stealth", dc: 10 } },
    ],
    state,
    fixed(0.5),
  )
  assert.equal(r.results.length, 3)
  assert.match(failureText(r.results[0], "apply_damage"), /ghost/)
  assert.match(failureText(r.results[1], "apply_damage"), /skipped/)
  assert.match(failureText(r.results[2], "roll_check"), /skipped/)
  assert.equal(r.state.enemies[0].hp, 7)
})

test("successful calls before a failure keep their effect on the state", () => {
  const r = executeTools(
    [
      { name: "apply_damage", args: { targetId: "e1", ...d4 } },
      { name: "apply_damage", args: { targetId: "ghost", ...d4 } },
      { name: "apply_damage", args: { targetId: "e1", ...d4 } },
    ],
    state,
    fixed(0.5),
  )
  assert.equal(r.results[0].isOk, true)
  failureText(r.results[1], "apply_damage")
  assert.match(failureText(r.results[2], "apply_damage"), /skipped/)
  assert.equal(r.state.enemies[0].hp, 4)
  assert.equal(state.enemies[0].hp, 7)
})

test("after a failed attack the next end_turn does not pass the turn", () => {
  // p1's turn, but the dagger id is wrong: the attack fails, end_turn must not run
  const fighting = { ...state, combat: { order: ["p1", "e1"], round: 1, activeCreatureId: "p1" } }
  const r = executeTools(
    [
      { name: "attack", args: { attackerId: "p1", weaponId: "sword", targetId: "e1" } },
      { name: "end_turn", args: { creatureId: "p1" } },
    ],
    fighting,
    fixed(0.5),
  )
  failureText(r.results[0], "attack")
  assert.match(failureText(r.results[1], "end_turn"), /skipped/)
  assert.equal(r.state.combat?.activeCreatureId, "p1")
})

test("an unknown tool after a failure is reported as skipped", () => {
  const r = executeTools(
    [
      { name: "end_combat", args: {} },
      { name: "heal", args: {} },
    ],
    state,
    fixed(0.5),
  )
  failureText(r.results[0], "end_combat")
  assert.match(failureText(r.results[1], "heal"), /skipped/)
})

test("an invalid args failure also skips the rest", () => {
  const r = executeTools(
    [
      { name: "attack", args: { attackerId: "p1", targetId: "e1" } },
      { name: "apply_damage", args: { targetId: "e1", ...d4 } },
    ],
    state,
    fixed(0.5),
  )
  failureText(r.results[0], "attack")
  assert.match(failureText(r.results[1], "apply_damage"), /skipped/)
  assert.equal(r.state.enemies[0].hp, 7)
})

test("the model can fix its mistake in the next round: end_turn, then attack", () => {
  // the goblin's turn; the model first attacks for the player, then passes the turn correctly
  const fighting = {
    ...state,
    enemies: [{ ...state.enemies[0], inventory: [scimitar] }],
    combat: { order: ["e1", "p1"], round: 1, activeCreatureId: "e1" },
  }
  const wrong = executeTools(
    [{ name: "attack", args: { attackerId: "p1", weaponId: "dagger", targetId: "e1" } }],
    fighting,
    fixed(0.5),
  )
  failureText(wrong.results[0], "attack")

  const fixedBatch = executeTools(
    [
      { name: "end_turn", args: { creatureId: "e1" } },
      { name: "attack", args: { attackerId: "p1", weaponId: "dagger", targetId: "e1" } },
    ],
    wrong.state,
    fixed(0.5),
  )
  assert.ok(fixedBatch.results.every((res) => res.isOk))
  assert.equal(fixedBatch.state.enemies[0].hp, 1)
})

// ---------- Master.handleMessage ----------

const ROOM = "room-1"

// In-memory store that records what Master did with the action
function fakeStore(initial: GameState) {
  const log = {
    current: structuredClone(initial),
    started: 0,
    committed: [] as GameState[],
    cancelled: 0,
    failStart: false,
  }
  const store: ActionStore = {
    async startAction(roomId) {
      assert.equal(roomId, ROOM)
      if (log.failStart) throw new Error("Room is locked")
      log.started++
      return structuredClone(log.current)
    },
    async commitAction(roomId, s) {
      assert.equal(roomId, ROOM)
      log.committed.push(structuredClone(s))
      log.current = structuredClone(s)
    },
    async cancelAction(roomId) {
      assert.equal(roomId, ROOM)
      log.cancelled++
    },
  }
  return { store, log }
}

// Scripted model: returns responses in order and snapshots every request
function fakeModel(script: Array<ModelResponse | Error>) {
  const calls: { messages: StoryMessage[]; tools: ToolDefinition[]; systemInstruction: string }[] =
    []
  const model: ModelProvider = {
    async generate(messages, tools, systemInstruction) {
      calls.push({ messages: structuredClone(messages), tools: [...tools], systemInstruction })
      const next = script.shift()
      if (next === undefined) throw new Error("Fake model script is exhausted")
      if (next instanceof Error) throw next
      return next
    },
  }
  return { model, calls }
}

// Model that never stops calling tools
function loopingModel() {
  let count = 0
  const model: ModelProvider = {
    async generate() {
      count++
      return {
        messageType: "tool_calls",
        calls: [{ name: "roll_check", args: { characterId: "p1", skill: "stealth", dc: 10 } }],
      }
    },
  }
  return { model, count: () => count }
}

const say = (text: string): ModelResponse => ({ messageType: "model_text", text })
const damage = (targetId: string): ModelResponse => ({
  messageType: "tool_calls",
  calls: [{ name: "apply_damage", args: { targetId, ...d4 } }],
})

test("handleMessage: plain text reply is returned and the action is committed", async () => {
  const { store, log } = fakeStore(state)
  const { model, calls } = fakeModel([say("Тишина.")])
  const master = new Master(store, ROOM, model, fixed(0.5))

  const reply = await master.handleMessage("Осматриваюсь")

  assert.equal(reply, "Тишина.")
  assert.equal(log.started, 1)
  assert.equal(log.committed.length, 1)
  assert.deepEqual(log.committed[0], state)
  assert.equal(log.cancelled, 0)
  assert.equal(calls.length, 1)
  assert.deepEqual(calls[0].messages, [{ messageType: "player_text", text: "Осматриваюсь" }])
})

test("handleMessage: model is offered every tool", async () => {
  const { store } = fakeStore(state)
  const { model, calls } = fakeModel([say("ok")])
  await new Master(store, ROOM, model, fixed(0.5)).handleMessage("hi")

  const tools = calls[0].tools
  assert.deepEqual(tools.map((t) => t.name).sort(), [
    "apply_damage",
    "apply_heal",
    "apply_healing_potion",
    "attack",
    "death_save",
    "delete_items",
    "end_combat",
    "end_turn",
    "give_items",
    "roll_check",
    "spawn_enemies",
    "start_combat",
    "transfer_items",
  ])
  for (const t of tools) {
    assert.ok(t.description.length > 0, `${t.name} has no description`)
    assert.equal(t.argsSchema.type, "object", `${t.name} args schema is not a JSON Schema object`)
  }
})

// The state is the JSON object after the role text; the role text itself has no braces
function stateFromInstruction(instruction: string): unknown {
  const start = instruction.indexOf("{")
  assert.ok(start >= 0, "system instruction has no JSON state")
  return JSON.parse(instruction.slice(start))
}

test("handleMessage: system instruction contains the master role and the room state", async () => {
  const { store } = fakeStore(state)
  const { model, calls } = fakeModel([say("ok")])
  await new Master(store, ROOM, model, fixed(0.5)).handleMessage("hi")

  const instruction = calls[0].systemInstruction
  assert.ok(
    !instruction.includes("[object Object]"),
    "an object was concatenated into the instruction",
  )
  assert.ok(instruction.includes(modelDefinition.modelInstruction), "role text is missing")
  assert.ok(
    instruction.indexOf(modelDefinition.modelInstruction) < instruction.indexOf("{"),
    "role text should come before the state",
  )
  assert.deepEqual(stateFromInstruction(instruction), state)
})

test("handleMessage: each round's system instruction shows the current draft", async () => {
  const { store } = fakeStore(state)
  const { model, calls } = fakeModel([damage("e1"), say("ok")])
  await new Master(store, ROOM, model, fixed(0.5)).handleMessage("Бью гоблина")

  const first = stateFromInstruction(calls[0].systemInstruction) as GameState
  const second = stateFromInstruction(calls[1].systemInstruction) as GameState
  assert.equal(first.enemies[0].hp, 7)
  assert.equal(second.enemies[0].hp, 4)
})

test("handleMessage: system instruction is not stored in history", async () => {
  const { store } = fakeStore(state)
  const { model, calls } = fakeModel([say("ok"), say("ok")])
  const master = new Master(store, ROOM, model, fixed(0.5))
  await master.handleMessage("Раз")
  await master.handleMessage("Два")

  const serialized = JSON.stringify(calls[1].messages)
  assert.ok(!serialized.includes(modelDefinition.modelInstruction))
  assert.ok(!serialized.includes("Подножие башни"))
})

test("handleMessage: tool calls are applied and the final state is committed", async () => {
  const { store, log } = fakeStore(state)
  const { model } = fakeModel([damage("e1"), say("Гоблин ранен.")])
  const master = new Master(store, ROOM, model, fixed(0.5))

  const reply = await master.handleMessage("Бью гоблина")

  assert.equal(reply, "Гоблин ранен.")
  assert.equal(log.committed.length, 1)
  assert.equal(log.committed[0].enemies[0].hp, 4)
  assert.equal(log.cancelled, 0)
})

test("handleMessage: model sees its tool calls and their results in the next round", async () => {
  const { store } = fakeStore(state)
  const { model, calls } = fakeModel([damage("e1"), say("ok")])
  await new Master(store, ROOM, model, fixed(0.5)).handleMessage("Бью гоблина")

  assert.equal(calls.length, 2)
  const msgs = calls[1].messages
  assert.deepEqual(
    msgs.map((m) => m.messageType),
    ["player_text", "tool_calls", "tool_results"],
  )
  assert.deepEqual(msgs[1], damage("e1"))
  const results = msgs[2]
  assert.ok(results.messageType === "tool_results")
  assert.equal(results.results.length, 1)
  const rec = results.results[0]
  assert.ok(rec.isOk && rec.tool === "apply_damage")
  assert.equal(rec.event.damage.hpBefore, 7)
  assert.equal(rec.event.damage.hpAfter, 4)
})

test("handleMessage: several tool rounds share one draft", async () => {
  const { store, log } = fakeStore(state)
  const { model, calls } = fakeModel([damage("e1"), damage("e1"), say("ok")])
  await new Master(store, ROOM, model, fixed(0.5)).handleMessage("Бью дважды")

  assert.equal(calls.length, 3)
  assert.equal(log.started, 1)
  assert.equal(log.committed.length, 1)
  assert.equal(log.committed[0].enemies[0].hp, 1)
})

test("handleMessage: rng from the constructor reaches the engine", async () => {
  const { store } = fakeStore(state)
  const { model, calls } = fakeModel([
    {
      messageType: "tool_calls",
      calls: [{ name: "roll_check", args: { characterId: "p1", skill: "stealth", dc: 25 } }],
    },
    say("ok"),
  ])
  await new Master(store, ROOM, model, fixed(0.999)).handleMessage("Крадусь")

  const results = calls[1].messages[2]
  assert.ok(results.messageType === "tool_results")
  const rec = results.results[0]
  assert.ok(rec.isOk && rec.tool === "roll_check")
  assert.equal(rec.event.roll, 20)
})

test("handleMessage: history persists between messages, including the model's reply", async () => {
  const { store } = fakeStore(state)
  const { model, calls } = fakeModel([damage("e1"), say("Ранен."), say("Убегает.")])
  const master = new Master(store, ROOM, model, fixed(0.5))

  await master.handleMessage("Бью")
  await master.handleMessage("Что дальше?")

  const msgs = calls[2].messages
  assert.deepEqual(
    msgs.map((m) => m.messageType),
    ["player_text", "tool_calls", "tool_results", "model_text", "player_text"],
  )
  assert.deepEqual(msgs[3], say("Ранен."))
  assert.deepEqual(msgs[4], { messageType: "player_text", text: "Что дальше?" })
})

test("handleMessage: engine refusal goes back to the model, the action is not cancelled", async () => {
  const { store, log } = fakeStore(state)
  const { model, calls } = fakeModel([damage("ghost"), say("Призрака здесь нет.")])
  const master = new Master(store, ROOM, model, fixed(0.5))

  const reply = await master.handleMessage("Бью призрака")

  assert.equal(reply, "Призрака здесь нет.")
  assert.equal(log.cancelled, 0)
  assert.equal(log.committed.length, 1)
  assert.deepEqual(log.committed[0], state)

  const results = calls[1].messages[2]
  assert.ok(results.messageType === "tool_results")
  assert.match(failureText(results.results[0], "apply_damage"), /ghost/)
})

test("handleMessage: the model fixes a refused call in the next round", async () => {
  const { store, log } = fakeStore(state)
  const { model } = fakeModel([damage("ghost"), damage("e1"), say("Гоблин ранен.")])
  const master = new Master(store, ROOM, model, fixed(0.5))

  await master.handleMessage("Бью")

  assert.equal(log.committed.length, 1)
  assert.equal(log.committed[0].enemies[0].hp, 4)
})

test("handleMessage: a refused call stays in history for the next messages", async () => {
  const { store } = fakeStore(state)
  const { model, calls } = fakeModel([damage("ghost"), say("Никого."), say("ok")])
  const master = new Master(store, ROOM, model, fixed(0.5))

  await master.handleMessage("Бью призрака")
  await master.handleMessage("Ещё раз")

  const msgs = calls[2].messages
  assert.deepEqual(
    msgs.map((m) => m.messageType),
    ["player_text", "tool_calls", "tool_results", "model_text", "player_text"],
  )
  const results = msgs[2]
  assert.ok(results.messageType === "tool_results")
  failureText(results.results[0], "apply_damage")
})

test("handleMessage: a model that keeps failing hits the round limit and cancels", async () => {
  const { store, log } = fakeStore(state)
  const { model } = fakeModel(Array.from({ length: 10 }, () => damage("ghost")))
  const master = new Master(store, ROOM, model, fixed(0.5))

  await assert.rejects(master.handleMessage("Бью призрака"))
  assert.equal(log.cancelled, 1)
  assert.equal(log.committed.length, 0)
})

test("handleMessage: model error cancels the action and is rethrown", async () => {
  const { store, log } = fakeStore(state)
  const { model } = fakeModel([new Error("Model is down")])
  const master = new Master(store, ROOM, model, fixed(0.5))

  await assert.rejects(master.handleMessage("Привет"), /Model is down/)
  assert.equal(log.cancelled, 1)
  assert.equal(log.committed.length, 0)
})

test("handleMessage: failed action leaves no trace in history", async () => {
  const { store } = fakeStore(state)
  const { model, calls } = fakeModel([
    say("Добро пожаловать."),
    damage("e1"),
    new Error("Model is down"),
    say("ok"),
  ])
  const master = new Master(store, ROOM, model, fixed(0.5))

  await master.handleMessage("Вхожу")
  await assert.rejects(master.handleMessage("Бью всех"))
  await master.handleMessage("Ещё раз")

  assert.deepEqual(calls[3].messages, [
    { messageType: "player_text", text: "Вхожу" },
    say("Добро пожаловать."),
    { messageType: "player_text", text: "Ещё раз" },
  ])
})

test("handleMessage: endless tool calls hit the round limit and cancel the action", async () => {
  const { store, log } = fakeStore(state)
  const { model, count } = loopingModel()
  const master = new Master(store, ROOM, model, fixed(0.5))

  await assert.rejects(master.handleMessage("Бью"))
  assert.ok(count() > 1, "model should get more than one round")
  assert.ok(count() <= 10, `too many rounds: ${count()}`)
  assert.equal(log.cancelled, 1)
  assert.equal(log.committed.length, 0)
})

test("Master: round limit must be a positive integer", () => {
  const { store } = fakeStore(state)
  const { model } = fakeModel([])
  for (const bad of [0, -1, 2.5, -1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => new Master(store, ROOM, model, fixed(0.5), bad), /integer/, String(bad))
  }
  assert.doesNotThrow(() => new Master(store, ROOM, model, fixed(0.5), 1))
  assert.doesNotThrow(() => new Master(store, ROOM, model, fixed(0.5)))
})

test("handleMessage: the round limit from the constructor is respected", async () => {
  const { store, log } = fakeStore(state)
  const { model, count } = loopingModel()
  const master = new Master(store, ROOM, model, fixed(0.5), 3)

  await assert.rejects(master.handleMessage("Бью"))
  assert.equal(count(), 3)
  assert.equal(log.cancelled, 1)
})

test("handleMessage: a limit of one round still allows a plain text reply", async () => {
  const { store, log } = fakeStore(state)
  const { model } = fakeModel([say("ok")])
  const master = new Master(store, ROOM, model, fixed(0.5), 1)

  assert.equal(await master.handleMessage("Привет"), "ok")
  assert.equal(log.committed.length, 1)
})

test("handleMessage: tools and the final text fit exactly into the limit", async () => {
  // two tool rounds and the text round: three rounds, a limit of 3 is enough
  const { store, log } = fakeStore(state)
  const { model } = fakeModel([damage("e1"), damage("e1"), say("ok")])
  const master = new Master(store, ROOM, model, fixed(0.5), 3)

  assert.equal(await master.handleMessage("Бью дважды"), "ok")
  assert.equal(log.committed[0].enemies[0].hp, 1)
})

test("handleMessage: failed start does not call the model or cancel", async () => {
  const { store, log } = fakeStore(state)
  log.failStart = true
  const { model, calls } = fakeModel([say("ok")])
  const master = new Master(store, ROOM, model, fixed(0.5))

  await assert.rejects(master.handleMessage("Привет"), /locked/)
  assert.equal(calls.length, 0)
  assert.equal(log.cancelled, 0)
})

// --- history compaction ---

const player = (text: string): StoryMessage => ({ messageType: "player_text", text })
const callsMsg: StoryMessage = {
  messageType: "tool_calls",
  calls: [{ name: "roll_check", args: { characterId: "p1", skill: "stealth", dc: 10 } }],
}
const resultsMsg: StoryMessage = {
  messageType: "tool_results",
  results: [{ isOk: false, tool: "roll_check", errorText: "test" }],
}

// One finished action as Master stores it: player text, tool rounds, final model text
function action(name: string, toolRounds = 1): StoryMessage[] {
  const rounds = Array.from({ length: toolRounds }, () => [callsMsg, resultsMsg]).flat()
  return [player(name), ...rounds, say(`answer ${name}`)]
}

const compacted = (name: string): StoryMessage[] => [player(name), say(`answer ${name}`)]

test("compactHistory: empty history stays empty", () => {
  assert.deepEqual(compactHistory([], 2), [])
})

test("compactHistory: fewer actions than kept are not changed", () => {
  const history = action("a")
  assert.deepEqual(compactHistory(history, 2), action("a"))
})

test("compactHistory: exactly the kept number of actions is not changed", () => {
  const history = [...action("a"), ...action("b", 2)]
  assert.deepEqual(compactHistory(history, 2), [...action("a"), ...action("b", 2)])
})

test("compactHistory: older actions keep only the player and model texts", () => {
  const history = [...action("a", 2), ...action("b"), ...action("c"), ...action("d", 3)]
  assert.deepEqual(compactHistory(history, 2), [
    ...compacted("a"),
    ...compacted("b"),
    ...action("c"),
    ...action("d", 3),
  ])
})

test("compactHistory: keeping one action compacts everything before the last", () => {
  const history = [...action("a"), ...action("b"), ...action("c", 2)]
  assert.deepEqual(compactHistory(history, 1), [
    ...compacted("a"),
    ...compacted("b"),
    ...action("c", 2),
  ])
})

test("compactHistory: actions without tool calls are already compact", () => {
  const history = [...compacted("a"), ...compacted("b"), ...compacted("c")]
  assert.deepEqual(compactHistory(history, 1), [
    ...compacted("a"),
    ...compacted("b"),
    ...compacted("c"),
  ])
})

test("compactHistory: every tool call keeps its results and vice versa", () => {
  const history = [...action("a", 2), ...action("b", 1), ...action("c", 3), ...action("d", 2)]
  const out = compactHistory(history, 2)
  out.forEach((m, i) => {
    if (m.messageType === "tool_calls")
      assert.equal(out[i + 1]?.messageType, "tool_results", `at ${i}`)
    if (m.messageType === "tool_results")
      assert.equal(out[i - 1]?.messageType, "tool_calls", `at ${i}`)
  })
})

test("compactHistory: compacting twice gives the same result as once", () => {
  const history = [...action("a", 2), ...action("b"), ...action("c")]
  const once = compactHistory(history, 1)
  assert.deepEqual(compactHistory(once, 1), once)
})

test("compactHistory: the input history is not mutated", () => {
  const history = [...action("a", 2), ...action("b"), ...action("c")]
  const copy = structuredClone(history)
  compactHistory(history, 1)
  assert.deepEqual(history, copy)
})

test("Master: number of full actions must be a positive integer", () => {
  const { store } = fakeStore(state)
  const { model } = fakeModel([])
  for (const bad of [0, -1, 2.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => new Master(store, ROOM, model, fixed(0.5), 5, bad), /integer/, String(bad))
  }
  assert.doesNotThrow(() => new Master(store, ROOM, model, fixed(0.5), 5, 1))
})

const types = (messages: StoryMessage[]) => messages.map((m) => m.messageType)

test("handleMessage: older actions reach the model compacted, the last ones in full", async () => {
  const { store } = fakeStore(state)
  const { model, calls } = fakeModel([
    damage("e1"),
    say("first"),
    damage("e1"),
    say("second"),
    say("third"),
  ])
  const master = new Master(store, ROOM, model, fixed(0.5), 5, 1)

  await master.handleMessage("one")
  await master.handleMessage("two")
  await master.handleMessage("three")

  // third message: action one compacted, action two (the last finished one) in full
  assert.deepEqual(types(calls[4].messages), [
    "player_text",
    "model_text",
    "player_text",
    "tool_calls",
    "tool_results",
    "model_text",
    "player_text",
  ])
  assert.deepEqual(calls[4].messages[1], say("first"))
})

test("handleMessage: the current action is not compacted between its rounds", async () => {
  const { store } = fakeStore(state)
  const { model, calls } = fakeModel([
    damage("e1"),
    say("first"),
    damage("e1"),
    damage("e1"),
    say("x"),
  ])
  const master = new Master(store, ROOM, model, fixed(0.5), 5, 1)

  await master.handleMessage("one")
  await master.handleMessage("two")

  // last round of the second message: action one in full, both rounds of the current one
  assert.deepEqual(types(calls[4].messages), [
    "player_text",
    "tool_calls",
    "tool_results",
    "model_text",
    "player_text",
    "tool_calls",
    "tool_results",
    "tool_calls",
    "tool_results",
  ])
})

test("handleMessage: a failed action does not compact the history", async () => {
  const { store } = fakeStore(state)
  const { model, calls } = fakeModel([
    damage("e1"),
    say("first"),
    damage("e1"),
    new Error("Model is down"),
    say("ok"),
  ])
  const master = new Master(store, ROOM, model, fixed(0.5), 5, 1)

  await master.handleMessage("one")
  await assert.rejects(master.handleMessage("two"))
  await master.handleMessage("three")

  assert.deepEqual(types(calls[4].messages), [
    "player_text",
    "tool_calls",
    "tool_results",
    "model_text",
    "player_text",
  ])
})

// --- story summary ---

test("splitHistoryForSummary: empty history gives nothing to summarize", () => {
  assert.deepEqual(splitHistoryForSummary([], 2, 2), {
    messagesToSummarize: [],
    messagesToKeep: [],
  })
})

test("splitHistoryForSummary: no old actions, nothing to summarize", () => {
  const history = [...action("a"), ...action("b")]
  const out = splitHistoryForSummary(history, 2, 1)
  assert.deepEqual(out.messagesToSummarize, [])
  assert.deepEqual(out.messagesToKeep, history)
})

test("splitHistoryForSummary: fewer old actions than the threshold are kept", () => {
  const history = [...compacted("a"), ...action("b"), ...action("c")]
  const out = splitHistoryForSummary(history, 2, 2)
  assert.deepEqual(out.messagesToSummarize, [])
  assert.deepEqual(out.messagesToKeep, history)
})

test("splitHistoryForSummary: at the threshold all old actions go to the summary", () => {
  const history = [...compacted("a"), ...compacted("b"), ...action("c"), ...action("d", 2)]
  const out = splitHistoryForSummary(history, 2, 2)
  assert.deepEqual(out.messagesToSummarize, [...compacted("a"), ...compacted("b")])
  assert.deepEqual(out.messagesToKeep, [...action("c"), ...action("d", 2)])
})

test("splitHistoryForSummary: above the threshold (after a failed summary) all old actions go", () => {
  const history = [
    ...compacted("a"),
    ...compacted("b"),
    ...compacted("c"),
    ...action("d"),
    ...action("e"),
  ]
  const out = splitHistoryForSummary(history, 2, 2)
  assert.deepEqual(out.messagesToSummarize, [
    ...compacted("a"),
    ...compacted("b"),
    ...compacted("c"),
  ])
  assert.deepEqual(out.messagesToKeep, [...action("d"), ...action("e")])
})

test("splitHistoryForSummary: a threshold of one summarizes the single old action", () => {
  const history = [...compacted("a"), ...action("b")]
  const out = splitHistoryForSummary(history, 1, 1)
  assert.deepEqual(out.messagesToSummarize, compacted("a"))
  assert.deepEqual(out.messagesToKeep, action("b"))
})

test("splitHistoryForSummary: the kept part starts with the player text of its first action", () => {
  const history = [...compacted("a"), ...compacted("b"), ...action("c")]
  const out = splitHistoryForSummary(history, 1, 2)
  assert.deepEqual(out.messagesToKeep[0], player("c"))
  // nothing is lost or duplicated
  assert.deepEqual([...out.messagesToSummarize, ...out.messagesToKeep], history)
})

test("splitHistoryForSummary: the input history is not mutated", () => {
  const history = [...compacted("a"), ...compacted("b"), ...action("c")]
  const copy = structuredClone(history)
  splitHistoryForSummary(history, 1, 2)
  assert.deepEqual(history, copy)
})

test("Master: number of actions to summarize must be a positive integer", () => {
  const { store } = fakeStore(state)
  const { model } = fakeModel([])
  for (const bad of [0, -1, 2.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(
      () => new Master(store, ROOM, model, fixed(0.5), 5, 1, bad),
      /integer/,
      String(bad),
    )
  }
  assert.doesNotThrow(() => new Master(store, ROOM, model, fixed(0.5), 5, 1, 1))
})

// Silences and counts console.error for one test
function muteErrors(t: TestContext) {
  return t.mock.method(console, "error", () => {})
}

test("handleMessage: old actions are folded into the summary at the threshold", async () => {
  const { store } = fakeStore(state)
  const { model, calls } = fakeModel([
    say("first"),
    say("second"),
    say("third"),
    say("SUMMARY-1"),
    say("fourth"),
  ])
  // one action kept full, two old actions make a summary
  const master = new Master(store, ROOM, model, fixed(0.5), 5, 1, 2)

  await master.handleMessage("one")
  await master.handleMessage("two")
  // below the threshold: no summary call yet, no summary in the instruction
  assert.equal(calls.length, 2)
  assert.doesNotMatch(calls[1].systemInstruction, /Story so far/)

  const reply = await master.handleMessage("three")
  assert.equal(reply, "third")

  // the summary call: only the old actions, no tools, the summary instruction, no game state
  const summaryCall = calls[3]
  assert.deepEqual(summaryCall.messages, [
    player("one"),
    say("first"),
    player("two"),
    say("second"),
  ])
  assert.deepEqual(summaryCall.tools, [])
  assert.ok(summaryCall.systemInstruction.startsWith(modelDefinition.summaryInstruction))
  assert.doesNotMatch(summaryCall.systemInstruction, /Current game state/)

  // the next action sees the summary instead of the folded actions
  await master.handleMessage("four")
  assert.deepEqual(calls[4].messages, [player("three"), say("third"), player("four")])
  assert.match(calls[4].systemInstruction, /Story so far: SUMMARY-1/)
  // the summary comes before the game state
  assert.ok(
    calls[4].systemInstruction.indexOf("SUMMARY-1") <
      calls[4].systemInstruction.indexOf("Current game state"),
  )
})

test("handleMessage: the summary is cumulative, the old one goes into the next summary call", async () => {
  const { store } = fakeStore(state)
  const { model, calls } = fakeModel([
    say("first"),
    say("second"),
    say("SUMMARY-1"),
    say("third"),
    say("SUMMARY-2"),
    say("fourth"),
    say("SUMMARY-3"),
  ])
  const master = new Master(store, ROOM, model, fixed(0.5), 5, 1, 1)

  await master.handleMessage("one")
  await master.handleMessage("two") // folds action one
  await master.handleMessage("three") // folds action two on top of SUMMARY-1
  await master.handleMessage("four")

  // second summary call: only action two, with the previous summary
  assert.deepEqual(calls[4].messages, [player("two"), say("second")])
  assert.match(calls[4].systemInstruction, /SUMMARY-1/)
  // the master sees only the newest summary
  assert.match(calls[5].systemInstruction, /Story so far: SUMMARY-2/)
  assert.doesNotMatch(calls[5].systemInstruction, /SUMMARY-1/)
})

test("handleMessage: a failed summary does not fail the action and keeps the history", async (t) => {
  const errors = muteErrors(t)
  const { store, log } = fakeStore(state)
  const { model, calls } = fakeModel([
    say("first"),
    say("second"),
    new Error("Model is down"),
    say("third"),
    say("SUMMARY"),
  ])
  const master = new Master(store, ROOM, model, fixed(0.5), 5, 1, 1)

  await master.handleMessage("one")
  const reply = await master.handleMessage("two")

  // the action is committed and answered, nothing is cancelled, the failure is logged
  assert.equal(reply, "second")
  assert.equal(log.committed.length, 2)
  assert.equal(log.cancelled, 0)
  assert.equal(errors.mock.callCount(), 1)

  // the next action still sees action one, and the summary is tried again with both old actions
  await master.handleMessage("three")
  assert.deepEqual(calls[3].messages, [
    player("one"),
    say("first"),
    player("two"),
    say("second"),
    player("three"),
  ])
  assert.doesNotMatch(calls[3].systemInstruction, /Story so far/)
  assert.deepEqual(calls[4].messages, [player("one"), say("first"), player("two"), say("second")])
})

test("handleMessage: tool calls instead of a summary count as a failure and run nothing", async (t) => {
  const errors = muteErrors(t)
  const { store, log } = fakeStore(state)
  const { model, calls } = fakeModel([say("first"), say("second"), damage("e1"), say("third")])
  const master = new Master(store, ROOM, model, fixed(0.5), 5, 1, 1)

  await master.handleMessage("one")
  assert.equal(await master.handleMessage("two"), "second")

  assert.equal(errors.mock.callCount(), 1)
  // the tool call of the summary model was not executed
  assert.deepEqual(log.current, state)
  assert.equal(log.committed.length, 2)

  await master.handleMessage("three")
  assert.doesNotMatch(calls[3].systemInstruction, /Story so far/)
  assert.deepEqual(calls[3].messages.slice(0, 2), [player("one"), say("first")])
})
