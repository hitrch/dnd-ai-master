import { test } from "node:test";
import assert from "node:assert/strict";
import { GameStateSchema } from "@dnd/shared";
import type { GameState, Tool } from "@dnd/shared";
import { executeTools, Master } from "./master";
import type { ActionStore, ModelProvider, ModelResponse, StoryMessage } from "./types";

const state = GameStateSchema.parse({
  location: "Подножие башни",
  players: [
    { id: "p1", name: "Арвен", hp: 12, maxHp: 12, skills: { stealth: 5, athletics: 1 } },
  ],
  enemies: [{ id: "e1", name: "Гоблин-часовой", hp: 7, maxHp: 7 }],
});

// rng = 0 rolls 1 on the die, 0.5 rolls 11, 0.999 rolls 20
const fixed = (v: number) => () => v;

test("empty list returns the same state and no records", () => {
  const r = executeTools([], state, fixed(0.5));
  assert.equal(r.state, state);
  assert.deepEqual(r.records, []);
});

test("records follow the order of calls", () => {
  const r = executeTools(
    [
      { name: "roll_check", args: { characterId: "p1", skill: "stealth", dc: 10 } },
      { name: "apply_damage", args: { targetId: "e1", amount: 3 } },
    ],
    state,
    fixed(0.5),
  );
  assert.deepEqual(r.records.map((rec) => rec.tool), ["roll_check", "apply_damage"]);
});

test("record contains parsed args and the engine event", () => {
  const r = executeTools(
    [{ name: "apply_damage", args: { targetId: "e1", amount: 3 } }],
    state,
    fixed(0.5),
  );
  const rec = r.records[0];
  assert.ok(rec.tool === "apply_damage");
  assert.deepEqual(rec.args, { targetId: "e1", amount: 3 });
  assert.equal(rec.event.hpBefore, 7);
  assert.equal(rec.event.hpAfter, 4);
});

test("rng is passed to the engine", () => {
  const r = executeTools(
    [{ name: "roll_check", args: { characterId: "p1", skill: "stealth", dc: 25 } }],
    state,
    fixed(0.999),
  );
  const rec = r.records[0];
  assert.ok(rec.tool === "roll_check");
  assert.equal(rec.event.roll, 20);
  assert.equal(rec.event.total, 25);
  assert.equal(rec.event.success, true);
});

test("each call sees the state produced by the previous one", () => {
  const r = executeTools(
    [
      { name: "apply_damage", args: { targetId: "e1", amount: 3 } },
      { name: "apply_damage", args: { targetId: "e1", amount: 2 } },
    ],
    state,
    fixed(0.5),
  );
  const second = r.records[1];
  assert.ok(second.tool === "apply_damage");
  assert.equal(second.event.hpBefore, 4);
  assert.equal(second.event.hpAfter, 2);
  assert.equal(r.state.enemies[0].hp, 2);
});

test("input state is not mutated", () => {
  executeTools(
    [{ name: "apply_damage", args: { targetId: "e1", amount: 3 } }],
    state,
    fixed(0.5),
  );
  assert.equal(state.enemies[0].hp, 7);
});

test("unknown tool name throws and mentions the name", () => {
  assert.throws(
    () => executeTools([{ name: "heal", args: {} }], state, fixed(0.5)),
    /heal/,
  );
});

test("inherited object property name is not accepted as a tool", () => {
  assert.throws(
    () => executeTools([{ name: "toString", args: {} }], state, fixed(0.5)),
    /toString/,
  );
});

test("invalid args are rejected before the engine", () => {
  assert.throws(() =>
    executeTools(
      [{ name: "roll_check", args: { characterId: "p1", skill: "stealth", dc: 100 } }],
      state,
      fixed(0.5),
    ),
  );
  assert.throws(() =>
    executeTools([{ name: "apply_damage", args: { targetId: "e1" } }], state, fixed(0.5)),
  );
});

test("engine error throws with the engine error text", () => {
  assert.throws(
    () =>
      executeTools(
        [{ name: "apply_damage", args: { targetId: "ghost", amount: 1 } }],
        state,
        fixed(0.5),
      ),
    /ghost/,
  );
});

test("error in the middle of the list aborts the run and leaves the input intact", () => {
  assert.throws(() =>
    executeTools(
      [
        { name: "apply_damage", args: { targetId: "e1", amount: 3 } },
        { name: "apply_damage", args: { targetId: "ghost", amount: 1 } },
      ],
      state,
      fixed(0.5),
    ),
  );
  assert.equal(state.enemies[0].hp, 7);
});

// ---------- Master.handleMessage ----------

const ROOM = "room-1";

// In-memory store that records what Master did with the action
function fakeStore(initial: GameState) {
  const log = {
    current: structuredClone(initial),
    started: 0,
    committed: [] as GameState[],
    cancelled: 0,
    failStart: false,
  };
  const store: ActionStore = {
    async startAction(roomId) {
      assert.equal(roomId, ROOM);
      if (log.failStart) throw new Error("Room is locked");
      log.started++;
      return structuredClone(log.current);
    },
    async commitAction(roomId, s) {
      assert.equal(roomId, ROOM);
      log.committed.push(structuredClone(s));
      log.current = structuredClone(s);
    },
    async cancelAction(roomId) {
      assert.equal(roomId, ROOM);
      log.cancelled++;
    },
  };
  return { store, log };
}

// Scripted model: returns responses in order and snapshots every request
function fakeModel(script: Array<ModelResponse | Error>) {
  const calls: { messages: StoryMessage[]; tools: Tool[] }[] = [];
  const model: ModelProvider = {
    async generate(messages, tools) {
      calls.push({ messages: structuredClone(messages), tools: [...tools] });
      const next = script.shift();
      if (next === undefined) throw new Error("Fake model script is exhausted");
      if (next instanceof Error) throw next;
      return next;
    },
  };
  return { model, calls };
}

// Model that never stops calling tools
function loopingModel() {
  let count = 0;
  const model: ModelProvider = {
    async generate() {
      count++;
      return {
        messageType: "tool_calls",
        calls: [{ name: "roll_check", args: { characterId: "p1", skill: "stealth", dc: 10 } }],
      };
    },
  };
  return { model, count: () => count };
}

const say = (text: string): ModelResponse => ({ messageType: "model_text", text });
const damage = (targetId: string, amount: number): ModelResponse => ({
  messageType: "tool_calls",
  calls: [{ name: "apply_damage", args: { targetId, amount } }],
});

test("handleMessage: plain text reply is returned and the action is committed", async () => {
  const { store, log } = fakeStore(state);
  const { model, calls } = fakeModel([say("Тишина.")]);
  const master = new Master(store, ROOM, model, fixed(0.5));

  const reply = await master.handleMessage("Осматриваюсь");

  assert.equal(reply, "Тишина.");
  assert.equal(log.started, 1);
  assert.equal(log.committed.length, 1);
  assert.deepEqual(log.committed[0], state);
  assert.equal(log.cancelled, 0);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].messages, [{ messageType: "player_text", text: "Осматриваюсь" }]);
});

test("handleMessage: model is offered every tool", async () => {
  const { store } = fakeStore(state);
  const { model, calls } = fakeModel([say("ok")]);
  await new Master(store, ROOM, model, fixed(0.5)).handleMessage("hi");

  assert.deepEqual([...calls[0].tools].sort(), ["apply_damage", "roll_check"]);
});

test("handleMessage: tool calls are applied and the final state is committed", async () => {
  const { store, log } = fakeStore(state);
  const { model } = fakeModel([damage("e1", 3), say("Гоблин ранен.")]);
  const master = new Master(store, ROOM, model, fixed(0.5));

  const reply = await master.handleMessage("Бью гоблина");

  assert.equal(reply, "Гоблин ранен.");
  assert.equal(log.committed.length, 1);
  assert.equal(log.committed[0].enemies[0].hp, 4);
  assert.equal(log.cancelled, 0);
});

test("handleMessage: model sees its tool calls and their results in the next round", async () => {
  const { store } = fakeStore(state);
  const { model, calls } = fakeModel([damage("e1", 3), say("ok")]);
  await new Master(store, ROOM, model, fixed(0.5)).handleMessage("Бью гоблина");

  assert.equal(calls.length, 2);
  const msgs = calls[1].messages;
  assert.deepEqual(
    msgs.map((m) => m.messageType),
    ["player_text", "tool_calls", "tool_results"],
  );
  assert.deepEqual(msgs[1], damage("e1", 3));
  const results = msgs[2];
  assert.ok(results.messageType === "tool_results");
  assert.equal(results.records.length, 1);
  const rec = results.records[0];
  assert.ok(rec.tool === "apply_damage");
  assert.equal(rec.event.hpBefore, 7);
  assert.equal(rec.event.hpAfter, 4);
});

test("handleMessage: several tool rounds share one draft", async () => {
  const { store, log } = fakeStore(state);
  const { model, calls } = fakeModel([damage("e1", 3), damage("e1", 2), say("ok")]);
  await new Master(store, ROOM, model, fixed(0.5)).handleMessage("Бью дважды");

  assert.equal(calls.length, 3);
  assert.equal(log.started, 1);
  assert.equal(log.committed.length, 1);
  assert.equal(log.committed[0].enemies[0].hp, 2);
});

test("handleMessage: rng from the constructor reaches the engine", async () => {
  const { store } = fakeStore(state);
  const { model, calls } = fakeModel([
    {
      messageType: "tool_calls",
      calls: [{ name: "roll_check", args: { characterId: "p1", skill: "stealth", dc: 25 } }],
    },
    say("ok"),
  ]);
  await new Master(store, ROOM, model, fixed(0.999)).handleMessage("Крадусь");

  const results = calls[1].messages[2];
  assert.ok(results.messageType === "tool_results");
  const rec = results.records[0];
  assert.ok(rec.tool === "roll_check");
  assert.equal(rec.event.roll, 20);
});

test("handleMessage: history persists between messages, including the model's reply", async () => {
  const { store } = fakeStore(state);
  const { model, calls } = fakeModel([damage("e1", 3), say("Ранен."), say("Убегает.")]);
  const master = new Master(store, ROOM, model, fixed(0.5));

  await master.handleMessage("Бью");
  await master.handleMessage("Что дальше?");

  const msgs = calls[2].messages;
  assert.deepEqual(
    msgs.map((m) => m.messageType),
    ["player_text", "tool_calls", "tool_results", "model_text", "player_text"],
  );
  assert.deepEqual(msgs[3], say("Ранен."));
  assert.deepEqual(msgs[4], { messageType: "player_text", text: "Что дальше?" });
});

test("handleMessage: engine error cancels the action and is rethrown", async () => {
  const { store, log } = fakeStore(state);
  const { model } = fakeModel([damage("ghost", 1)]);
  const master = new Master(store, ROOM, model, fixed(0.5));

  await assert.rejects(master.handleMessage("Бью призрака"), /ghost/);
  assert.equal(log.cancelled, 1);
  assert.equal(log.committed.length, 0);
});

test("handleMessage: model error cancels the action and is rethrown", async () => {
  const { store, log } = fakeStore(state);
  const { model } = fakeModel([new Error("Model is down")]);
  const master = new Master(store, ROOM, model, fixed(0.5));

  await assert.rejects(master.handleMessage("Привет"), /Model is down/);
  assert.equal(log.cancelled, 1);
  assert.equal(log.committed.length, 0);
});

test("handleMessage: failed action leaves no trace in history", async () => {
  const { store } = fakeStore(state);
  const { model, calls } = fakeModel([
    say("Добро пожаловать."),
    damage("e1", 3),
    damage("ghost", 1),
    say("ok"),
  ]);
  const master = new Master(store, ROOM, model, fixed(0.5));

  await master.handleMessage("Вхожу");
  await assert.rejects(master.handleMessage("Бью всех"));
  await master.handleMessage("Ещё раз");

  assert.deepEqual(calls[3].messages, [
    { messageType: "player_text", text: "Вхожу" },
    say("Добро пожаловать."),
    { messageType: "player_text", text: "Ещё раз" },
  ]);
});

test("handleMessage: endless tool calls hit the round limit and cancel the action", async () => {
  const { store, log } = fakeStore(state);
  const { model, count } = loopingModel();
  const master = new Master(store, ROOM, model, fixed(0.5));

  await assert.rejects(master.handleMessage("Бью"));
  assert.ok(count() > 1, "model should get more than one round");
  assert.ok(count() <= 10, `too many rounds: ${count()}`);
  assert.equal(log.cancelled, 1);
  assert.equal(log.committed.length, 0);
});

test("handleMessage: failed start does not call the model or cancel", async () => {
  const { store, log } = fakeStore(state);
  log.failStart = true;
  const { model, calls } = fakeModel([say("ok")]);
  const master = new Master(store, ROOM, model, fixed(0.5));

  await assert.rejects(master.handleMessage("Привет"), /locked/);
  assert.equal(calls.length, 0);
  assert.equal(log.cancelled, 0);
});