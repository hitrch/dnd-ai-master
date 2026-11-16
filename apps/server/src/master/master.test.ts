import { test } from "node:test"
import assert from "node:assert/strict"
import { GameStateSchema } from "@dnd/shared"
import type { GameState } from "@dnd/shared"
import { executeTools, Master } from "./master"
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
      weapons: [
        {
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
      weapons: [],
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
  assert.equal(rec.event.hpBefore, 7)
  assert.equal(rec.event.hpAfter, 4)
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
  assert.equal(rec.event.nextTurn.nextCreatureId, "e1")
  assert.equal(r.state.combat?.activeCreatureId, "e1")
})

test("end_turn refused by the engine returns a failed result", () => {
  const r = executeTools([{ name: "end_turn", args: { creatureId: "p1" } }], state, fixed(0.5))
  failureText(r.results[0], "end_turn")
})

const scimitar = {
  id: "scimitar",
  name: "Скимитар",
  attackBonus: 4,
  damage: { diceCount: 1, diceSides: 6 as const, bonus: 2 },
}

test("a full round in one batch: the attacks pass the turns themselves", () => {
  // every d20 rolls 11: 11 + 5 = 16 vs AC 15 and 11 + 4 = 15 vs AC 14, both attacks hit
  const fighting = {
    ...state,
    enemies: [{ ...state.enemies[0], weapons: [scimitar] }],
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
  assert.equal(second.event.hpBefore, 4)
  assert.equal(second.event.hpAfter, 1)
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
  assert.deepEqual(rec.event.rolls, [1])
  assert.equal(rec.event.amount, 1)
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
    enemies: [{ ...state.enemies[0], weapons: [scimitar] }],
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
    "attack",
    "death_save",
    "end_combat",
    "end_turn",
    "roll_check",
    "start_combat",
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
  assert.equal(rec.event.hpBefore, 7)
  assert.equal(rec.event.hpAfter, 4)
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
