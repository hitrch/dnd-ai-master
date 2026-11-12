import { test } from "node:test"
import assert from "node:assert/strict"
import { GameStateSchema, ToolArgsSchemas } from "@dnd/shared"
import type { GameState } from "@dnd/shared"
import { rollCheck, applyDamage, attack, deathSave } from "./engine"

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
      weapons: [
        {
          id: "scimitar",
          name: "Скимитар",
          attackBonus: 4,
          damage: { diceCount: 1, diceSides: 6, bonus: 2 },
        },
      ],
      skills: { stealth: 6 },
    },
  ],
})

// rng = 0 rolls 1 on the die, 0.5 rolls 11, 0.999 rolls 20
const fixed = (v: number) => () => v

test("failure: 1 + modifier 5 vs DC 10", () => {
  const r = rollCheck(state, { characterId: "p1", skill: "stealth", dc: 10 }, fixed(0))
  assert.ok(r.isOk)
  assert.equal(r.event.roll, 1)
  assert.equal(r.event.total, 6)
  assert.equal(r.event.success, false)
})

test("success on tie: 11 + 5 = 16 vs DC 16", () => {
  const r = rollCheck(state, { characterId: "p1", skill: "stealth", dc: 16 }, fixed(0.5))
  assert.ok(r.isOk)
  assert.equal(r.event.total, 16)
  assert.equal(r.event.success, true)
})

test("skill not on sheet: modifier 0", () => {
  const r = rollCheck(state, { characterId: "p1", skill: "intimidation", dc: 10 }, fixed(0.5))
  assert.ok(r.isOk)
  assert.equal(r.event.modifier, 0)
})

test("check does not change state: returns the same object", () => {
  const r = rollCheck(state, { characterId: "p1", skill: "stealth", dc: 10 }, fixed(0.5))
  assert.ok(r.isOk)
  assert.equal(r.state, state)
})

test("unknown character returns an error", () => {
  const r = rollCheck(state, { characterId: "nobody", skill: "stealth", dc: 10 })
  assert.equal(r.isOk, false)
})

test("check by a character at 0 HP returns an error and rolls nothing", () => {
  const down = { ...state, players: [{ ...state.players[0], hp: 0 }] }
  const r = rollCheck(down, { characterId: "p1", skill: "stealth", dc: 10 }, () => {
    throw new Error("rng must not be called")
  })
  assert.equal(r.isOk, false)
})

// Returns the given values in order and counts how many were requested
function sequence(...values: number[]) {
  let calls = 0
  const rng = () => {
    const value = values[calls]
    calls++
    assert.notEqual(value, undefined, "rng was called more times than expected")
    return value
  }
  return { rng, calls: () => calls }
}

test("damage reduces HP and does not mutate the original state", () => {
  // 1d6 with rng = 0.5 rolls 4
  const r = applyDamage(state, { targetId: "p1", diceCount: 1, diceSides: 6, bonus: 0 }, fixed(0.5))
  assert.ok(r.isOk)
  assert.equal(r.event.hpBefore, 12)
  assert.equal(r.event.hpAfter, 8)
  assert.equal(r.state.players[0].hp, 8)
  assert.equal(state.players[0].hp, 12)
})

test("damage: amount is the sum of rolls and bonus", () => {
  // d6: 0.5 rolls 4, 0.7 rolls 5
  const { rng } = sequence(0.5, 0.7)
  const r = applyDamage(state, { targetId: "p1", diceCount: 2, diceSides: 6, bonus: 3 }, rng)
  assert.ok(r.isOk)
  assert.deepEqual(r.event.rolls, [4, 5])
  assert.equal(r.event.bonus, 3)
  assert.equal(r.event.amount, 12)
  assert.equal(r.event.hpAfter, 0)
})

test("damage: rng is called exactly once per die", () => {
  const { rng, calls } = sequence(0.1, 0.2, 0.3)
  const r = applyDamage(state, { targetId: "p1", diceCount: 3, diceSides: 8, bonus: 0 }, rng)
  assert.ok(r.isOk)
  assert.equal(r.event.rolls.length, 3)
  assert.equal(calls(), 3)
})

test("damage: rolls stay within the die for every allowed die", () => {
  for (const diceSides of [4, 6, 8, 10, 12, 20] as const) {
    const lowest = applyDamage(
      state,
      { targetId: "p1", diceCount: 1, diceSides, bonus: 0 },
      fixed(0),
    )
    const highest = applyDamage(
      state,
      { targetId: "p1", diceCount: 1, diceSides, bonus: 0 },
      fixed(0.999),
    )
    assert.ok(lowest.isOk)
    assert.ok(highest.isOk)
    assert.deepEqual(lowest.event.rolls, [1])
    assert.deepEqual(highest.event.rolls, [diceSides])
  }
})

test("damage: a check after the generalized die still rolls a d20", () => {
  const r = rollCheck(state, { characterId: "p1", skill: "stealth", dc: 10 }, fixed(0.999))
  assert.ok(r.isOk)
  assert.equal(r.event.roll, 20)
})

test("HP does not go below zero, enemy at 0 HP is dead", () => {
  const r = applyDamage(
    state,
    { targetId: "e1", diceCount: 10, diceSides: 20, bonus: 10 },
    fixed(0.999),
  )
  assert.ok(r.isOk)
  assert.equal(r.event.hpAfter, 0)
  assert.equal(r.event.outcome, "dead")
})

test("enemy that survives the damage is alive", () => {
  // d4 = 3
  const r = applyDamage(state, { targetId: "e1", diceCount: 1, diceSides: 4, bonus: 0 }, fixed(0.5))
  assert.ok(r.isOk)
  assert.equal(r.event.hpAfter, 4)
  assert.equal(r.event.outcome, "alive")
})

test("unknown target returns an error", () => {
  const r = applyDamage(
    state,
    { targetId: "ghost", diceCount: 1, diceSides: 4, bonus: 0 },
    fixed(0.5),
  )
  assert.equal(r.isOk, false)
})

test("damage args schema: accepts the boundaries", () => {
  const schema = ToolArgsSchemas.apply_damage
  assert.equal(
    schema.safeParse({ targetId: "e1", diceCount: 1, diceSides: 4, bonus: 0 }).success,
    true,
  )
  assert.equal(
    schema.safeParse({ targetId: "e1", diceCount: 10, diceSides: 20, bonus: 10 }).success,
    true,
  )
})

test("damage args schema: rejects values out of range and the old amount", () => {
  const schema = ToolArgsSchemas.apply_damage
  const valid = { targetId: "e1", diceCount: 1, diceSides: 6, bonus: 0 }
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
  ]
  for (const args of invalid) {
    assert.equal(schema.safeParse(args).success, false, JSON.stringify(args))
  }
})

// ---------- attack ----------
// d20: 0 rolls 1, 0.4 rolls 9, 0.45 rolls 10, 0.5 rolls 11, 0.999 rolls 20
// d4: 0 rolls 1, 0.5 rolls 3, 0.999 rolls 4; d6: 0.5 rolls 4

const daggerAtGoblin = { attackerId: "p1", weaponId: "dagger", targetId: "e1" }

// The sample state with some fields of the goblin replaced
function withGoblin(patch: Partial<GameState["enemies"][number]>): GameState {
  return { ...state, enemies: [{ ...state.enemies[0], ...patch }] }
}

test("attack: hit fills the event and deals weapon damage", () => {
  // d20 = 11, 11 + 5 = 16 vs AC 15; d4 = 3, 3 + 3 = 6
  const { rng } = sequence(0.5, 0.5)
  const r = attack(state, daggerAtGoblin, rng)
  assert.ok(r.isOk)
  const { damage, ...roll } = r.event
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
  })
  assert.deepEqual(damage, {
    targetId: "e1",
    targetName: "Гоблин-часовой",
    amount: 6,
    rolls: [3],
    bonus: 3,
    hpBefore: 7,
    hpAfter: 1,
    outcome: "alive",
  })
  assert.equal(r.state.enemies[0].hp, 1)
})

test("attack: does not mutate the original state", () => {
  const { rng } = sequence(0.5, 0.5)
  const r = attack(state, daggerAtGoblin, rng)
  assert.ok(r.isOk)
  assert.equal(state.enemies[0].hp, 7)
})

test("attack: total equal to AC hits", () => {
  // d20 = 10, 10 + 5 = 15 vs AC 15
  const { rng } = sequence(0.45, 0.5)
  const r = attack(state, daggerAtGoblin, rng)
  assert.ok(r.isOk)
  assert.equal(r.event.total, 15)
  assert.equal(r.event.hasHit, true)
})

test("attack: miss has no damage, keeps the same state and rolls only the d20", () => {
  // d20 = 9, 9 + 5 = 14 vs AC 15
  const { rng, calls } = sequence(0.4)
  const r = attack(state, daggerAtGoblin, rng)
  assert.ok(r.isOk)
  assert.equal(r.event.total, 14)
  assert.equal(r.event.hasHit, false)
  assert.equal(r.event.isCritical, false)
  assert.equal(r.event.damage, null)
  assert.equal(r.state, state)
  assert.equal(calls(), 1)
})

test("attack: natural 20 is a critical hit that doubles the dice, not the bonus", () => {
  // 1d4 doubled to 2d4: rolls 1 and 4, + 3 = 8
  const { rng, calls } = sequence(0.999, 0, 0.999)
  const r = attack(state, daggerAtGoblin, rng)
  assert.ok(r.isOk)
  assert.equal(r.event.roll, 20)
  assert.equal(r.event.hasHit, true)
  assert.equal(r.event.isCritical, true)
  assert.ok(r.event.damage)
  assert.deepEqual(r.event.damage.rolls, [1, 4])
  assert.equal(r.event.damage.bonus, 3)
  assert.equal(r.event.damage.amount, 8)
  assert.equal(r.event.damage.hpAfter, 0)
  assert.equal(r.event.damage.outcome, "dead")
  assert.equal(calls(), 3)
})

test("attack: natural 20 hits even when the total is below AC", () => {
  // 20 + 5 = 25 vs AC 30
  const { rng } = sequence(0.999, 0, 0)
  const r = attack(withGoblin({ armorClass: 30 }), daggerAtGoblin, rng)
  assert.ok(r.isOk)
  assert.equal(r.event.total, 25)
  assert.equal(r.event.hasHit, true)
  assert.equal(r.event.isCritical, true)
})

test("attack: natural 1 misses even when the total reaches AC", () => {
  // 1 + 5 = 6 vs AC 5
  const lowAc = withGoblin({ armorClass: 5 })
  const { rng, calls } = sequence(0)
  const r = attack(lowAc, daggerAtGoblin, rng)
  assert.ok(r.isOk)
  assert.equal(r.event.roll, 1)
  assert.equal(r.event.total, 6)
  assert.equal(r.event.hasHit, false)
  assert.equal(r.event.isCritical, false)
  assert.equal(r.event.damage, null)
  assert.equal(r.state, lowAc)
  assert.equal(calls(), 1)
})

test("attack: an enemy can attack a player", () => {
  // d20 = 11, 11 + 4 = 15 vs AC 14; d6 = 4, 4 + 2 = 6
  const { rng } = sequence(0.5, 0.5)
  const r = attack(state, { attackerId: "e1", weaponId: "scimitar", targetId: "p1" }, rng)
  assert.ok(r.isOk)
  assert.equal(r.event.attackerName, "Гоблин-часовой")
  assert.equal(r.event.weaponName, "Скимитар")
  assert.equal(r.event.targetArmorClass, 14)
  assert.equal(r.event.hasHit, true)
  assert.ok(r.event.damage)
  assert.equal(r.event.damage.amount, 6)
  assert.equal(r.state.players[0].hp, 6)
})

test("attack: refusals return an error and roll nothing", () => {
  const cases: Array<
    [string, GameState, { attackerId: string; weaponId: string; targetId: string }]
  > = [
    ["unknown attacker", state, { ...daggerAtGoblin, attackerId: "nobody" }],
    ["unknown target", state, { ...daggerAtGoblin, targetId: "ghost" }],
    ["weapon of someone else", state, { ...daggerAtGoblin, weaponId: "scimitar" }],
    ["unknown weapon", state, { ...daggerAtGoblin, weaponId: "bow" }],
    [
      "attacker at 0 HP",
      withGoblin({ hp: 0 }),
      { attackerId: "e1", weaponId: "scimitar", targetId: "p1" },
    ],
    ["target at 0 HP", withGoblin({ hp: 0 }), daggerAtGoblin],
  ]
  for (const [name, caseState, args] of cases) {
    // an empty sequence fails on any rng call
    const { rng } = sequence()
    const r = attack(caseState, args, rng)
    assert.equal(r.isOk, false, name)
    assert.ok(!r.isOk && r.errorText.length > 0, name)
  }
})

// ---------- death saving throws ----------
// d20: 0 rolls 1, 0.05 rolls 2, 0.4 rolls 9, 0.45 rolls 10, 0.5 rolls 11, 0.999 rolls 20

type Player = GameState["players"][number]

// The sample state with the player down at 0 HP and some fields replaced
function withDownPlayer(patch: Partial<Player> = {}): GameState {
  return { ...state, players: [{ ...state.players[0], hp: 0, ...patch }] }
}

const saveP1 = { characterId: "p1" }

test("death save: 10 is a success and fills the event", () => {
  const { rng, calls } = sequence(0.45)
  const r = deathSave(withDownPlayer(), saveP1, rng)
  assert.ok(r.isOk)
  assert.deepEqual(r.event, {
    characterId: "p1",
    characterName: "Арвен",
    roll: 10,
    successes: 1,
    failures: 0,
    outcome: "success",
  })
  assert.equal(r.state.players[0].saveRollSuccesses, 1)
  assert.equal(r.state.players[0].saveRollFails, 0)
  assert.equal(r.state.players[0].hp, 0)
  assert.equal(calls(), 1)
})

test("death save: 9 is a failure", () => {
  const r = deathSave(withDownPlayer(), saveP1, fixed(0.4))
  assert.ok(r.isOk)
  assert.equal(r.event.roll, 9)
  assert.equal(r.event.outcome, "failure")
  assert.equal(r.event.failures, 1)
  assert.equal(r.event.successes, 0)
  assert.equal(r.state.players[0].saveRollFails, 1)
})

test("death save: 2 is a single failure", () => {
  const r = deathSave(withDownPlayer(), saveP1, fixed(0.05))
  assert.ok(r.isOk)
  assert.equal(r.event.roll, 2)
  assert.equal(r.event.failures, 1)
})

test("death save: natural 1 counts as two failures", () => {
  const r = deathSave(withDownPlayer(), saveP1, fixed(0))
  assert.ok(r.isOk)
  assert.equal(r.event.roll, 1)
  assert.equal(r.event.outcome, "failure")
  assert.equal(r.event.failures, 2)
  assert.equal(r.state.players[0].saveRollFails, 2)
})

test("death save: third failure is death and keeps the counters", () => {
  const r = deathSave(
    withDownPlayer({ saveRollFails: 2, saveRollSuccesses: 1 }),
    saveP1,
    fixed(0.4),
  )
  assert.ok(r.isOk)
  assert.equal(r.event.outcome, "dead")
  assert.equal(r.event.failures, 3)
  assert.equal(r.event.successes, 1)
  assert.equal(r.state.players[0].saveRollFails, 3)
  assert.equal(r.state.players[0].isStabilizedAfterSave, false)
})

test("death save: natural 1 with two failures is death, failures do not go above 3", () => {
  const r = deathSave(withDownPlayer({ saveRollFails: 2 }), saveP1, fixed(0))
  assert.ok(r.isOk)
  assert.equal(r.event.outcome, "dead")
  assert.equal(r.event.failures, 3)
  assert.equal(r.state.players[0].saveRollFails, 3)
})

test("death save: a dead character cannot roll again", () => {
  const dead = deathSave(withDownPlayer({ saveRollFails: 2 }), saveP1, fixed(0))
  assert.ok(dead.isOk)
  const { rng } = sequence()
  const r = deathSave(dead.state, saveP1, rng)
  assert.equal(r.isOk, false)
})

test("death save: third success makes the character stable and resets the counters", () => {
  const r = deathSave(
    withDownPlayer({ saveRollSuccesses: 2, saveRollFails: 2 }),
    saveP1,
    fixed(0.5),
  )
  assert.ok(r.isOk)
  assert.equal(r.event.outcome, "stable")
  assert.equal(r.event.successes, 0)
  assert.equal(r.event.failures, 0)
  const player = r.state.players[0]
  assert.equal(player.isStabilizedAfterSave, true)
  assert.equal(player.saveRollSuccesses, 0)
  assert.equal(player.saveRollFails, 0)
  assert.equal(player.hp, 0)
})

test("death save: a stable character cannot roll again", () => {
  const stable = deathSave(withDownPlayer({ saveRollSuccesses: 2 }), saveP1, fixed(0.5))
  assert.ok(stable.isOk)
  const { rng } = sequence()
  const r = deathSave(stable.state, saveP1, rng)
  assert.equal(r.isOk, false)
})

test("death save: natural 20 revives with 1 HP and resets the counters", () => {
  const r = deathSave(
    withDownPlayer({ saveRollSuccesses: 2, saveRollFails: 2 }),
    saveP1,
    fixed(0.999),
  )
  assert.ok(r.isOk)
  assert.equal(r.event.roll, 20)
  assert.equal(r.event.outcome, "revived")
  assert.equal(r.event.successes, 0)
  assert.equal(r.event.failures, 0)
  const player = r.state.players[0]
  assert.equal(player.hp, 1)
  assert.equal(player.saveRollSuccesses, 0)
  assert.equal(player.saveRollFails, 0)
  assert.equal(player.isStabilizedAfterSave, false)
})

test("death save: replaces the character in place and keeps the others", () => {
  const other: Player = { ...state.players[0], id: "p2", name: "Борин" }
  const twoPlayers: GameState = { ...state, players: [{ ...state.players[0], hp: 0 }, other] }
  const r = deathSave(twoPlayers, saveP1, fixed(0.5))
  assert.ok(r.isOk)
  assert.equal(r.state.players.length, 2)
  assert.deepEqual(
    r.state.players.map((p) => p.id),
    ["p1", "p2"],
  )
  assert.equal(r.state.players[0].saveRollSuccesses, 1)
  assert.equal(r.state.players[1], other)
  assert.equal(r.state.enemies, twoPlayers.enemies)
})

test("death save: does not mutate the original state", () => {
  const down = withDownPlayer()
  const r = deathSave(down, saveP1, fixed(0.5))
  assert.ok(r.isOk)
  assert.equal(down.players[0].saveRollSuccesses, 0)
  assert.equal(down.players[0].hp, 0)
})

test("death save: refusals return an error and roll nothing", () => {
  const cases: Array<[string, GameState, { characterId: string }]> = [
    ["unknown character", withDownPlayer(), { characterId: "nobody" }],
    ["character with HP", state, saveP1],
    ["dead character", withDownPlayer({ saveRollFails: 3 }), saveP1],
    ["stable character", withDownPlayer({ isStabilizedAfterSave: true }), saveP1],
    ["enemy is not a character", withGoblin({ hp: 0 }), { characterId: "e1" }],
  ]
  for (const [name, caseState, args] of cases) {
    const { rng } = sequence()
    const r = deathSave(caseState, args, rng)
    assert.equal(r.isOk, false, name)
    assert.ok(!r.isOk && r.errorText.length > 0, name)
  }
})

// ---------- damage to a player: dropping to 0, damage at 0 HP, instant death ----------
// Player p1: maxHp 12, AC 14. Goblin scimitar: +4 to hit, 1d6 + 2.
// d4: 0 rolls 1, 0.25 rolls 2, 0.5 rolls 3; d6: 0 rolls 1, 0.999 rolls 6; d8: 0.8 rolls 7

// The sample state with some fields of the player replaced (HP stays 12 unless patched)
function withPlayer(patch: Partial<Player>): GameState {
  return { ...state, players: [{ ...state.players[0], ...patch }] }
}

const scimitarAtP1 = { attackerId: "e1", weaponId: "scimitar", targetId: "p1" }

test("player damage: surviving player is alive and keeps the counters", () => {
  const r = applyDamage(state, { targetId: "p1", diceCount: 1, diceSides: 4, bonus: 0 }, fixed(0.5))
  assert.ok(r.isOk)
  assert.equal(r.event.hpAfter, 9)
  assert.equal(r.event.outcome, "alive")
  assert.equal(r.state.players[0].saveRollFails, 0)
})

test("player damage: dropping to 0 is down, death saves start from zero", () => {
  // 6 damage on 5 HP: 1 left over, far below maxHp 12
  const before = withPlayer({
    hp: 5,
    saveRollFails: 2,
    saveRollSuccesses: 1,
    isStabilizedAfterSave: true,
  })
  const r = applyDamage(
    before,
    { targetId: "p1", diceCount: 1, diceSides: 6, bonus: 0 },
    fixed(0.999),
  )
  assert.ok(r.isOk)
  assert.equal(r.event.hpAfter, 0)
  assert.equal(r.event.outcome, "down")
  const player = r.state.players[0]
  assert.equal(player.hp, 0)
  assert.equal(player.saveRollFails, 0)
  assert.equal(player.saveRollSuccesses, 0)
  assert.equal(player.isStabilizedAfterSave, false)
})

test("player damage: down player can make a death save after dropping to 0", () => {
  const r = applyDamage(
    withPlayer({ hp: 5 }),
    { targetId: "p1", diceCount: 1, diceSides: 6, bonus: 0 },
    fixed(0.999),
  )
  assert.ok(r.isOk)
  const save = deathSave(r.state, saveP1, fixed(0.5))
  assert.ok(save.isOk)
})

test("player damage: damage at 0 HP is one failure and keeps the successes", () => {
  const r = applyDamage(
    withDownPlayer({ saveRollSuccesses: 2 }),
    { targetId: "p1", diceCount: 1, diceSides: 4, bonus: 0 },
    fixed(0),
  )
  assert.ok(r.isOk)
  assert.equal(r.event.hpBefore, 0)
  assert.equal(r.event.hpAfter, 0)
  assert.equal(r.event.outcome, "down")
  const player = r.state.players[0]
  assert.equal(player.hp, 0)
  assert.equal(player.saveRollFails, 1)
  assert.equal(player.saveRollSuccesses, 2)
})

test("player damage: a down player can be attacked, a hit is one failure", () => {
  // d20 = 11, 11 + 4 = 15 vs AC 14; d6 = 1, 1 + 2 = 3
  const { rng } = sequence(0.5, 0)
  const r = attack(withDownPlayer(), scimitarAtP1, rng)
  assert.ok(r.isOk)
  assert.equal(r.event.hasHit, true)
  assert.ok(r.event.damage)
  assert.equal(r.event.damage.outcome, "down")
  assert.equal(r.state.players[0].saveRollFails, 1)
})

test("player damage: a critical hit at 0 HP is two failures", () => {
  // natural 20, 2d6 = 1 + 1, + 2 = 4
  const { rng, calls } = sequence(0.999, 0, 0)
  const r = attack(withDownPlayer(), scimitarAtP1, rng)
  assert.ok(r.isOk)
  assert.equal(r.event.isCritical, true)
  assert.ok(r.event.damage)
  assert.equal(r.event.damage.outcome, "down")
  assert.equal(r.state.players[0].saveRollFails, 2)
  assert.equal(calls(), 3)
})

test("player damage: third failure from damage is death", () => {
  const r = applyDamage(
    withDownPlayer({ saveRollFails: 2 }),
    { targetId: "p1", diceCount: 1, diceSides: 4, bonus: 0 },
    fixed(0),
  )
  assert.ok(r.isOk)
  assert.equal(r.event.outcome, "dead")
  assert.equal(r.state.players[0].saveRollFails, 3)
})

test("player damage: failures from a critical hit do not go above 3", () => {
  const { rng } = sequence(0.999, 0, 0)
  const r = attack(withDownPlayer({ saveRollFails: 2 }), scimitarAtP1, rng)
  assert.ok(r.isOk)
  assert.ok(r.event.damage)
  assert.equal(r.event.damage.outcome, "dead")
  assert.equal(r.state.players[0].saveRollFails, 3)
})

test("player damage: damage to a stable player removes stability and is a failure", () => {
  const r = applyDamage(
    withDownPlayer({ isStabilizedAfterSave: true }),
    { targetId: "p1", diceCount: 1, diceSides: 4, bonus: 0 },
    fixed(0),
  )
  assert.ok(r.isOk)
  assert.equal(r.event.outcome, "down")
  assert.equal(r.state.players[0].isStabilizedAfterSave, false)
  assert.equal(r.state.players[0].saveRollFails, 1)
  // death saves resume
  const save = deathSave(r.state, saveP1, fixed(0.5))
  assert.ok(save.isOk)
})

test("player damage: leftover damage equal to maxHp is instant death", () => {
  // 7 + 10 = 17 on 5 HP: 12 left over = maxHp
  const r = applyDamage(
    withPlayer({ hp: 5 }),
    { targetId: "p1", diceCount: 1, diceSides: 8, bonus: 10 },
    fixed(0.8),
  )
  assert.ok(r.isOk)
  assert.equal(r.event.amount, 17)
  assert.equal(r.event.hpAfter, 0)
  assert.equal(r.event.outcome, "dead")
  assert.equal(r.state.players[0].hp, 0)
  assert.equal(r.state.players[0].saveRollFails, 3)
  const save = deathSave(r.state, saveP1, fixed(0.5))
  assert.equal(save.isOk, false)
})

test("player damage: leftover damage one below maxHp is only down", () => {
  // 6 + 10 = 16 on 5 HP: 11 left over
  const r = applyDamage(
    withPlayer({ hp: 5 }),
    { targetId: "p1", diceCount: 1, diceSides: 6, bonus: 10 },
    fixed(0.999),
  )
  assert.ok(r.isOk)
  assert.equal(r.event.amount, 16)
  assert.equal(r.event.outcome, "down")
  assert.equal(r.state.players[0].saveRollFails, 0)
})

test("player damage: at 0 HP, damage equal to maxHp is instant death", () => {
  // 2 + 10 = 12 = maxHp
  const r = applyDamage(
    withDownPlayer(),
    { targetId: "p1", diceCount: 1, diceSides: 4, bonus: 10 },
    fixed(0.25),
  )
  assert.ok(r.isOk)
  assert.equal(r.event.amount, 12)
  assert.equal(r.event.outcome, "dead")
  assert.equal(r.state.players[0].saveRollFails, 3)
})

test("player damage: at 0 HP, damage one below maxHp is a single failure", () => {
  // 1 + 10 = 11
  const r = applyDamage(
    withDownPlayer(),
    { targetId: "p1", diceCount: 1, diceSides: 4, bonus: 10 },
    fixed(0),
  )
  assert.ok(r.isOk)
  assert.equal(r.event.amount, 11)
  assert.equal(r.event.outcome, "down")
  assert.equal(r.state.players[0].saveRollFails, 1)
})

test("player damage: does not mutate the original state and keeps the enemies", () => {
  const down = withDownPlayer()
  const r = applyDamage(down, { targetId: "p1", diceCount: 1, diceSides: 4, bonus: 0 }, fixed(0))
  assert.ok(r.isOk)
  assert.equal(down.players[0].saveRollFails, 0)
  assert.equal(r.state.enemies, down.enemies)
})

test("damage refusals: dead player and enemy at 0 HP, nothing is rolled", () => {
  const dead = withDownPlayer({ saveRollFails: 3 })
  const damage = { diceCount: 1, diceSides: 4, bonus: 0 } as const
  const cases: Array<[string, () => { isOk: boolean }]> = [
    [
      "apply_damage to a dead player",
      () => applyDamage(dead, { targetId: "p1", ...damage }, sequence().rng),
    ],
    ["attack on a dead player", () => attack(dead, scimitarAtP1, sequence().rng)],
    [
      "apply_damage to an enemy at 0 HP",
      () => applyDamage(withGoblin({ hp: 0 }), { targetId: "e1", ...damage }, sequence().rng),
    ],
  ]
  for (const [name, run] of cases) {
    const r = run()
    assert.equal(r.isOk, false, name)
  }
})
