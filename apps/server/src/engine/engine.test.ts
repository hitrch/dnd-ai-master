import { test } from "node:test";
import assert from "node:assert/strict";
import { GameStateSchema, ToolArgsSchemas } from "@dnd/shared";
import { rollCheck, applyDamage } from "./engine";

const state = GameStateSchema.parse({
  location: "Подножие башни",
  players: [
    { id: "p1", name: "Арвен", hp: 12, maxHp: 12, skills: { stealth: 5, athletics: 1 } },
  ],
  enemies: [{ id: "e1", name: "Гоблин-часовой", hp: 7, maxHp: 7 }],
});

// rng = 0 rolls 1 on the die, 0.5 rolls 11, 0.999 rolls 20
const fixed = (v: number) => () => v;

test("failure: 1 + modifier 5 vs DC 10", () => {
  const r = rollCheck(state, { characterId: "p1", skill: "stealth", dc: 10 }, fixed(0));
  assert.ok(r.isOk);
  assert.equal(r.event.roll, 1);
  assert.equal(r.event.total, 6);
  assert.equal(r.event.success, false);
});

test("success on tie: 11 + 5 = 16 vs DC 16", () => {
  const r = rollCheck(state, { characterId: "p1", skill: "stealth", dc: 16 }, fixed(0.5));
  assert.ok(r.isOk);
  assert.equal(r.event.total, 16);
  assert.equal(r.event.success, true);
});

test("skill not on sheet: modifier 0", () => {
  const r = rollCheck(state, { characterId: "p1", skill: "intimidation", dc: 10 }, fixed(0.5));
  assert.ok(r.isOk);
  assert.equal(r.event.modifier, 0);
});

test("check does not change state: returns the same object", () => {
  const r = rollCheck(state, { characterId: "p1", skill: "stealth", dc: 10 }, fixed(0.5));
  assert.ok(r.isOk);
  assert.equal(r.state, state);
});

test("unknown character returns an error", () => {
  const r = rollCheck(state, { characterId: "nobody", skill: "stealth", dc: 10 });
  assert.equal(r.isOk, false);
});

// Returns the given values in order and counts how many were requested
function sequence(...values: number[]) {
  let calls = 0;
  const rng = () => {
    const value = values[calls];
    calls++;
    assert.notEqual(value, undefined, "rng was called more times than expected");
    return value;
  };
  return { rng, calls: () => calls };
}

test("damage reduces HP and does not mutate the original state", () => {
  // 1d6 with rng = 0.5 rolls 4
  const r = applyDamage(state, { targetId: "p1", diceCount: 1, diceSides: 6, bonus: 0 }, fixed(0.5));
  assert.ok(r.isOk);
  assert.equal(r.event.hpBefore, 12);
  assert.equal(r.event.hpAfter, 8);
  assert.equal(r.state.players[0].hp, 8);
  assert.equal(state.players[0].hp, 12);
});

test("damage: amount is the sum of rolls and bonus", () => {
  // d6: 0.5 rolls 4, 0.7 rolls 5
  const { rng } = sequence(0.5, 0.7);
  const r = applyDamage(state, { targetId: "p1", diceCount: 2, diceSides: 6, bonus: 3 }, rng);
  assert.ok(r.isOk);
  assert.deepEqual(r.event.rolls, [4, 5]);
  assert.equal(r.event.bonus, 3);
  assert.equal(r.event.amount, 12);
  assert.equal(r.event.hpAfter, 0);
});

test("damage: rng is called exactly once per die", () => {
  const { rng, calls } = sequence(0.1, 0.2, 0.3);
  const r = applyDamage(state, { targetId: "p1", diceCount: 3, diceSides: 8, bonus: 0 }, rng);
  assert.ok(r.isOk);
  assert.equal(r.event.rolls.length, 3);
  assert.equal(calls(), 3);
});

test("damage: rolls stay within the die for every allowed die", () => {
  for (const diceSides of [4, 6, 8, 10, 12, 20] as const) {
    const lowest = applyDamage(state, { targetId: "p1", diceCount: 1, diceSides, bonus: 0 }, fixed(0));
    const highest = applyDamage(state, { targetId: "p1", diceCount: 1, diceSides, bonus: 0 }, fixed(0.999));
    assert.ok(lowest.isOk);
    assert.ok(highest.isOk);
    assert.deepEqual(lowest.event.rolls, [1]);
    assert.deepEqual(highest.event.rolls, [diceSides]);
  }
});

test("damage: a check after the generalized die still rolls a d20", () => {
  const r = rollCheck(state, { characterId: "p1", skill: "stealth", dc: 10 }, fixed(0.999));
  assert.ok(r.isOk);
  assert.equal(r.event.roll, 20);
});

test("HP does not go below zero, target is defeated", () => {
  const r = applyDamage(state, { targetId: "e1", diceCount: 10, diceSides: 20, bonus: 10 }, fixed(0.999));
  assert.ok(r.isOk);
  assert.equal(r.event.hpAfter, 0);
  assert.equal(r.event.isDefeated, true);
});

test("unknown target returns an error", () => {
  const r = applyDamage(state, { targetId: "ghost", diceCount: 1, diceSides: 4, bonus: 0 }, fixed(0.5));
  assert.equal(r.isOk, false);
});

test("damage args schema: accepts the boundaries", () => {
  const schema = ToolArgsSchemas.apply_damage;
  assert.equal(schema.safeParse({ targetId: "e1", diceCount: 1, diceSides: 4, bonus: 0 }).success, true);
  assert.equal(schema.safeParse({ targetId: "e1", diceCount: 10, diceSides: 20, bonus: 10 }).success, true);
});

test("damage args schema: rejects values out of range and the old amount", () => {
  const schema = ToolArgsSchemas.apply_damage;
  const valid = { targetId: "e1", diceCount: 1, diceSides: 6, bonus: 0 };
  const invalid = [
    { ...valid, diceCount: 0 },
    { ...valid, diceCount: 11 },
    { ...valid, diceCount: 1.5 },
    { ...valid, diceSides: 7 },
    { ...valid, diceSides: 100 },
    { ...valid, bonus: -1 },
    { ...valid, bonus: 11 },
    { ...valid, bonus: 0.5 },
    { targetId: "e1", amount: 1000 },
  ];
  for (const args of invalid) {
    assert.equal(schema.safeParse(args).success, false, JSON.stringify(args));
  }
});
