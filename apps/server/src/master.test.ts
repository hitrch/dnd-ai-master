import { test } from "node:test";
import assert from "node:assert/strict";
import { GameStateSchema } from "@dnd/shared";
import { executeTools } from "./master";

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