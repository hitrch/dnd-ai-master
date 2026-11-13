import { test } from "node:test"
import assert from "node:assert/strict"
import { GameStateSchema } from "@dnd/shared"
import type { GameState } from "@dnd/shared"
import { executeTools, Master } from "./master"
import { modelDefinition } from "./modelDefinition"
import { toolDefinitions } from "./toolDefinitions"
import type { ModelProvider, ModelResponse, StoryMessage, ToolDefinition } from "../model/types"
import type { ActionStore } from "../types"

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

test("empty list returns the same state and no records", () => {
  const r = executeTools([], state, fixed(0.5))
  assert.equal(r.state, state)
  assert.deepEqual(r.records, [])
})

test("records follow the order of calls", () => {
  const r = executeTools(
    [
      { name: "roll_check", args: { characterId: "p1", skill: "stealth", dc: 10 } },
      { name: "apply_damage", args: { targetId: "e1", ...d4 } },
    ],
    state,
    fixed(0.5),
  )
  assert.deepEqual(
    r.records.map((rec) => rec.tool),
    ["roll_check", "apply_damage"],
  )
})

test("record contains parsed args and the engine event", () => {
  const r = executeTools(
    [{ name: "apply_damage", args: { targetId: "e1", ...d4 } }],
    state,
    fixed(0.5),
  )
  const rec = r.records[0]
  assert.ok(rec.tool === "apply_damage")
  assert.deepEqual(rec.args, { targetId: "e1", ...d4 })
  assert.equal(rec.event.hpBefore, 7)
  assert.equal(rec.event.hpAfter, 4)
})

test("attack call is executed by the engine and recorded", () => {
  // d20 = 11, 11 + 5 = 16 vs AC 15; d4 = 3, 3 + 3 = 6
  const args = { attackerId: "p1", weaponId: "dagger", targetId: "e1" }
  const r = executeTools([{ name: "attack", args }], state, fixed(0.5))
  const rec = r.records[0]
  assert.ok(rec.tool === "attack")
  assert.deepEqual(rec.args, args)
  assert.equal(rec.event.hasHit, true)
  assert.equal(rec.event.damage?.hpAfter, 1)
  assert.equal(r.state.enemies[0].hp, 1)
})

test("death_save call is executed by the engine and recorded", () => {
  // d20 = 11: a success
  const down = { ...state, players: [{ ...state.players[0], hp: 0 }] }
  const r = executeTools([{ name: "death_save", args: { characterId: "p1" } }], down, fixed(0.5))
  const rec = r.records[0]
  assert.ok(rec.tool === "death_save")
  assert.deepEqual(rec.args, { characterId: "p1" })
  assert.equal(rec.event.outcome, "success")
  assert.equal(r.state.players[0].saveRollSuccesses, 1)
})

test("death_save refused by the engine throws", () => {
  // the character is not down
  assert.throws(() =>
    executeTools([{ name: "death_save", args: { characterId: "p1" } }], state, fixed(0.5)),
  )
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
  const rec = r.records[0]
  assert.ok(rec.tool === "apply_heal")
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
  const rec = r.records[0]
  assert.ok(rec.tool === "start_combat")
  assert.deepEqual(rec.args, args)
  assert.deepEqual(
    rec.event.participantsOrder.map((p) => p.id),
    ["p1", "e1"],
  )
  assert.deepEqual(r.state.combat, { order: ["p1", "e1"], round: 1, activeCreatureId: "p1" })
})

test("start_combat refused by the engine throws", () => {
  // a repeated id passes the schema but not the engine
  assert.throws(() =>
    executeTools(
      [{ name: "start_combat", args: { participantIds: ["e1", "e1"] } }],
      state,
      fixed(0.5),
    ),
  )
})

test("end_combat call is executed by the engine and recorded, extra args are dropped", () => {
  const fighting = { ...state, combat: { order: ["p1", "e1"], round: 2, activeCreatureId: "p1" } }
  const r = executeTools([{ name: "end_combat", args: { reason: "fled" } }], fighting, fixed(0.5))
  const rec = r.records[0]
  assert.ok(rec.tool === "end_combat")
  assert.deepEqual(rec.args, {})
  assert.deepEqual(rec.event, { lastRound: 2 })
  assert.equal(r.state.combat, null)
})

test("end_combat refused by the engine throws", () => {
  assert.throws(() => executeTools([{ name: "end_combat", args: {} }], state, fixed(0.5)))
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
    r.records.map((rec) => rec.tool),
    ["start_combat", "end_combat"],
  )
})

test("combat tools are described to the model", () => {
  for (const name of ["start_combat", "end_combat"]) {
    const definition = toolDefinitions.find((d) => d.name === name)
    assert.ok(definition, name)
    assert.ok(definition.description.length > 0, name)
    assert.equal(definition.argsSchema.type, "object", name)
  }
})

test("apply_heal refused by the engine throws", () => {
  // the goblin at 0 HP is dead
  const deadGoblin = { ...state, enemies: [{ ...state.enemies[0], hp: 0 }] }
  assert.throws(() =>
    executeTools([{ name: "apply_heal", args: { targetId: "e1", ...d4 } }], deadGoblin, fixed(0.5)),
  )
})

test("apply_heal is described to the model", () => {
  const definition = toolDefinitions.find((d) => d.name === "apply_heal")
  assert.ok(definition)
  assert.ok(definition.description.length > 0)
})

test("attack with an invalid args shape throws", () => {
  assert.throws(() =>
    executeTools(
      [{ name: "attack", args: { attackerId: "p1", targetId: "e1" } }],
      state,
      fixed(0.5),
    ),
  )
})

test("attack refused by the engine throws its error text", () => {
  const args = { attackerId: "p1", weaponId: "scimitar", targetId: "e1" }
  assert.throws(() => executeTools([{ name: "attack", args }], state, fixed(0.5)), /scimitar/)
})

test("rng is passed to the engine", () => {
  const r = executeTools(
    [{ name: "roll_check", args: { characterId: "p1", skill: "stealth", dc: 25 } }],
    state,
    fixed(0.999),
  )
  const rec = r.records[0]
  assert.ok(rec.tool === "roll_check")
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
  const second = r.records[1]
  assert.ok(second.tool === "apply_damage")
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
  const rec = r.records[0]
  assert.ok(rec.tool === "apply_damage")
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

test("unknown tool name throws and mentions the name", () => {
  assert.throws(() => executeTools([{ name: "heal", args: {} }], state, fixed(0.5)), /heal/)
})

test("inherited object property name is not accepted as a tool", () => {
  assert.throws(() => executeTools([{ name: "toString", args: {} }], state, fixed(0.5)), /toString/)
})

test("invalid args are rejected before the engine", () => {
  assert.throws(() =>
    executeTools(
      [{ name: "roll_check", args: { characterId: "p1", skill: "stealth", dc: 100 } }],
      state,
      fixed(0.5),
    ),
  )
  assert.throws(() =>
    executeTools([{ name: "apply_damage", args: { targetId: "e1" } }], state, fixed(0.5)),
  )
})

test("engine error throws with the engine error text", () => {
  assert.throws(
    () =>
      executeTools(
        [{ name: "apply_damage", args: { targetId: "ghost", ...d4 } }],
        state,
        fixed(0.5),
      ),
    /ghost/,
  )
})

test("error in the middle of the list aborts the run and leaves the input intact", () => {
  assert.throws(() =>
    executeTools(
      [
        { name: "apply_damage", args: { targetId: "e1", ...d4 } },
        { name: "apply_damage", args: { targetId: "ghost", ...d4 } },
      ],
      state,
      fixed(0.5),
    ),
  )
  assert.equal(state.enemies[0].hp, 7)
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
  assert.equal(results.records.length, 1)
  const rec = results.records[0]
  assert.ok(rec.tool === "apply_damage")
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
  const rec = results.records[0]
  assert.ok(rec.tool === "roll_check")
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

test("handleMessage: engine error cancels the action and is rethrown", async () => {
  const { store, log } = fakeStore(state)
  const { model } = fakeModel([damage("ghost")])
  const master = new Master(store, ROOM, model, fixed(0.5))

  await assert.rejects(master.handleMessage("Бью призрака"), /ghost/)
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
    damage("ghost"),
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

test("handleMessage: failed start does not call the model or cancel", async () => {
  const { store, log } = fakeStore(state)
  log.failStart = true
  const { model, calls } = fakeModel([say("ok")])
  const master = new Master(store, ROOM, model, fixed(0.5))

  await assert.rejects(master.handleMessage("Привет"), /locked/)
  assert.equal(calls.length, 0)
  assert.equal(log.cancelled, 0)
})
