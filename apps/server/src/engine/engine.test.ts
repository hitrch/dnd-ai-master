import { test } from "node:test";
import assert from "node:assert/strict";
import { GameStateSchema } from "@dnd/shared";
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

test("damage reduces HP and does not mutate the original state", () => {
  const r = applyDamage(state, { targetId: "p1", amount: 4 });
  assert.ok(r.isOk);
  assert.equal(r.event.hpBefore, 12);
  assert.equal(r.event.hpAfter, 8);
  assert.equal(r.state.players[0].hp, 8);
  assert.equal(state.players[0].hp, 12);
});

test("HP does not go below zero, target is defeated", () => {
  const r = applyDamage(state, { targetId: "e1", amount: 100 });
  assert.ok(r.isOk);
  assert.equal(r.event.hpAfter, 0);
  assert.equal(r.event.isDefeated, true);
});

test("unknown target returns an error", () => {
  const r = applyDamage(state, { targetId: "ghost", amount: 1 });
  assert.equal(r.isOk, false);
});
