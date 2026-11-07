import { test } from "node:test";
import assert from "node:assert/strict";
import { GameStateSchema, ToolArgsSchemas } from "@dnd/shared";
import type { GameState } from "@dnd/shared";
import { rollCheck, applyDamage, attack } from "./engine";

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
        { id: "dagger", name: "Кинжал", attackBonus: 5, damage: { diceCount: 1, diceSides: 4, bonus: 3 } },
      ],
      skills: { stealth: 5, athletics: 1 },
    },
  ],
  enemies: [
    {
      id: "e1",
      name: "Гоблин-часовой",
      hp: 7,
      maxHp: 7,
      armorClass: 15,
      weapons: [
        { id: "scimitar", name: "Скимитар", attackBonus: 4, damage: { diceCount: 1, diceSides: 6, bonus: 2 } },
      ],
      skills: { stealth: 6 },
    },
  ],
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

// ---------- attack ----------
// d20: 0 rolls 1, 0.4 rolls 9, 0.45 rolls 10, 0.5 rolls 11, 0.999 rolls 20
// d4: 0 rolls 1, 0.5 rolls 3, 0.999 rolls 4; d6: 0.5 rolls 4

const daggerAtGoblin = { attackerId: "p1", weaponId: "dagger", targetId: "e1" };

// The sample state with some fields of the goblin replaced
function withGoblin(patch: Partial<GameState["enemies"][number]>): GameState {
  return { ...state, enemies: [{ ...state.enemies[0], ...patch }] };
}

test("attack: hit fills the event and deals weapon damage", () => {
  // d20 = 11, 11 + 5 = 16 vs AC 15; d4 = 3, 3 + 3 = 6
  const { rng } = sequence(0.5, 0.5);
  const r = attack(state, daggerAtGoblin, rng);
  assert.ok(r.isOk);
  const { damage, ...roll } = r.event;
  assert.deepEqual(roll, {
    attackerId: "p1",
    attackerName: "Арвен",
    targetId: "e1",
    targetName: "Гоблин-часовой",
    weaponId: "dagger",
    weaponName: "Кинжал",
    targetArmorClass: 15,
    roll: 11,
    attackBonus: 5,
    total: 16,
    hasHit: true,
    isCritical: false,
  });
  assert.deepEqual(damage, {
    targetId: "e1",
    targetName: "Гоблин-часовой",
    amount: 6,
    rolls: [3],
    bonus: 3,
    hpBefore: 7,
    hpAfter: 1,
    isDefeated: false,
  });
  assert.equal(r.state.enemies[0].hp, 1);
});

test("attack: does not mutate the original state", () => {
  const { rng } = sequence(0.5, 0.5);
  const r = attack(state, daggerAtGoblin, rng);
  assert.ok(r.isOk);
  assert.equal(state.enemies[0].hp, 7);
});

test("attack: total equal to AC hits", () => {
  // d20 = 10, 10 + 5 = 15 vs AC 15
  const { rng } = sequence(0.45, 0.5);
  const r = attack(state, daggerAtGoblin, rng);
  assert.ok(r.isOk);
  assert.equal(r.event.total, 15);
  assert.equal(r.event.hasHit, true);
});

test("attack: miss has no damage, keeps the same state and rolls only the d20", () => {
  // d20 = 9, 9 + 5 = 14 vs AC 15
  const { rng, calls } = sequence(0.4);
  const r = attack(state, daggerAtGoblin, rng);
  assert.ok(r.isOk);
  assert.equal(r.event.total, 14);
  assert.equal(r.event.hasHit, false);
  assert.equal(r.event.isCritical, false);
  assert.equal(r.event.damage, null);
  assert.equal(r.state, state);
  assert.equal(calls(), 1);
});

test("attack: natural 20 is a critical hit that doubles the dice, not the bonus", () => {
  // 1d4 doubled to 2d4: rolls 1 and 4, + 3 = 8
  const { rng, calls } = sequence(0.999, 0, 0.999);
  const r = attack(state, daggerAtGoblin, rng);
  assert.ok(r.isOk);
  assert.equal(r.event.roll, 20);
  assert.equal(r.event.hasHit, true);
  assert.equal(r.event.isCritical, true);
  assert.ok(r.event.damage);
  assert.deepEqual(r.event.damage.rolls, [1, 4]);
  assert.equal(r.event.damage.bonus, 3);
  assert.equal(r.event.damage.amount, 8);
  assert.equal(r.event.damage.hpAfter, 0);
  assert.equal(r.event.damage.isDefeated, true);
  assert.equal(calls(), 3);
});

test("attack: natural 20 hits even when the total is below AC", () => {
  // 20 + 5 = 25 vs AC 30
  const { rng } = sequence(0.999, 0, 0);
  const r = attack(withGoblin({ armorClass: 30 }), daggerAtGoblin, rng);
  assert.ok(r.isOk);
  assert.equal(r.event.total, 25);
  assert.equal(r.event.hasHit, true);
  assert.equal(r.event.isCritical, true);
});

test("attack: natural 1 misses even when the total reaches AC", () => {
  // 1 + 5 = 6 vs AC 5
  const lowAc = withGoblin({ armorClass: 5 });
  const { rng, calls } = sequence(0);
  const r = attack(lowAc, daggerAtGoblin, rng);
  assert.ok(r.isOk);
  assert.equal(r.event.roll, 1);
  assert.equal(r.event.total, 6);
  assert.equal(r.event.hasHit, false);
  assert.equal(r.event.isCritical, false);
  assert.equal(r.event.damage, null);
  assert.equal(r.state, lowAc);
  assert.equal(calls(), 1);
});

test("attack: an enemy can attack a player", () => {
  // d20 = 11, 11 + 4 = 15 vs AC 14; d6 = 4, 4 + 2 = 6
  const { rng } = sequence(0.5, 0.5);
  const r = attack(state, { attackerId: "e1", weaponId: "scimitar", targetId: "p1" }, rng);
  assert.ok(r.isOk);
  assert.equal(r.event.attackerName, "Гоблин-часовой");
  assert.equal(r.event.weaponName, "Скимитар");
  assert.equal(r.event.targetArmorClass, 14);
  assert.equal(r.event.hasHit, true);
  assert.ok(r.event.damage);
  assert.equal(r.event.damage.amount, 6);
  assert.equal(r.state.players[0].hp, 6);
});

test("attack: refusals return an error and roll nothing", () => {
  const cases: Array<[string, GameState, { attackerId: string; weaponId: string; targetId: string }]> = [
    ["unknown attacker", state, { ...daggerAtGoblin, attackerId: "nobody" }],
    ["unknown target", state, { ...daggerAtGoblin, targetId: "ghost" }],
    ["weapon of someone else", state, { ...daggerAtGoblin, weaponId: "scimitar" }],
    ["unknown weapon", state, { ...daggerAtGoblin, weaponId: "bow" }],
    ["attacker at 0 HP", withGoblin({ hp: 0 }), { attackerId: "e1", weaponId: "scimitar", targetId: "p1" }],
    ["target at 0 HP", withGoblin({ hp: 0 }), daggerAtGoblin],
  ];
  for (const [name, caseState, args] of cases) {
    // an empty sequence fails on any rng call
    const { rng } = sequence();
    const r = attack(caseState, args, rng);
    assert.equal(r.isOk, false, name);
    assert.ok(!r.isOk && r.errorText.length > 0, name);
  }
});
