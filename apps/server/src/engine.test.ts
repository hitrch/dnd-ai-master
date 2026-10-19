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

// rng = 0 даёт 1 на кубике, 0.5 даёт 11, 0.999 даёт 20
const fixed = (v: number) => () => v;

test("провал: 1 + модификатор 5 против DC 10", () => {
  const r = rollCheck(state, { characterId: "p1", skill: "stealth", dc: 10 }, fixed(0));
  assert.ok(r.ok);
  assert.equal(r.roll, 1);
  assert.equal(r.total, 6);
  assert.equal(r.success, false);
});

test("успех при равенстве: 11 + 5 = 16 против DC 16", () => {
  const r = rollCheck(state, { characterId: "p1", skill: "stealth", dc: 16 }, fixed(0.5));
  assert.ok(r.ok);
  assert.equal(r.total, 16);
  assert.equal(r.success, true);
});

test("навык вне листа: модификатор 0", () => {
  const r = rollCheck(state, { characterId: "p1", skill: "intimidation", dc: 10 }, fixed(0.5));
  assert.ok(r.ok);
  assert.equal(r.modifier, 0);
});

test("неизвестный персонаж даёт ошибку", () => {
  const r = rollCheck(state, { characterId: "nobody", skill: "stealth", dc: 10 });
  assert.equal(r.ok, false);
});

test("урон уменьшает HP и не меняет исходное состояние", () => {
  const r = applyDamage(state, { targetId: "p1", amount: 4 });
  assert.ok(r.ok);
  assert.equal(r.hpBefore, 12);
  assert.equal(r.hpAfter, 8);
  assert.equal(r.state.players[0].hp, 8);
  assert.equal(state.players[0].hp, 12);
});

test("HP не уходит ниже нуля, цель побеждена", () => {
  const r = applyDamage(state, { targetId: "e1", amount: 100 });
  assert.ok(r.ok);
  assert.equal(r.hpAfter, 0);
  assert.equal(r.defeated, true);
});

test("неизвестная цель даёт ошибку", () => {
  const r = applyDamage(state, { targetId: "ghost", amount: 1 });
  assert.equal(r.ok, false);
});