import { test } from "node:test"
import assert from "node:assert/strict"
import { GameStateSchema, ToolArgsSchemas } from "@dnd/shared"
import type { GameState } from "@dnd/shared"
import {
  rollCheck,
  applyDamage,
  applyHeal,
  attack,
  deathSave,
  startCombat,
  endCombat,
  endTurn,
} from "./engine"

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
      weapons: [
        {
          id: "scimitar",
          name: "Скимитар",
          attackBonus: 4,
          damage: { diceCount: 1, diceSides: 6, bonus: 2 },
        },
      ],
      skills: { stealth: 6 },
      initiativeModifier: 2,
    },
  ],
  combat: null,
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
  assert.equal(r.event.damage.hpBefore, 12)
  assert.equal(r.event.damage.hpAfter, 8)
  assert.equal(r.state.players[0].hp, 8)
  assert.equal(state.players[0].hp, 12)
})

test("damage: amount is the sum of rolls and bonus", () => {
  // d6: 0.5 rolls 4, 0.7 rolls 5
  const { rng } = sequence(0.5, 0.7)
  const r = applyDamage(state, { targetId: "p1", diceCount: 2, diceSides: 6, bonus: 3 }, rng)
  assert.ok(r.isOk)
  assert.deepEqual(r.event.damage.rolls, [4, 5])
  assert.equal(r.event.damage.bonus, 3)
  assert.equal(r.event.damage.amount, 12)
  assert.equal(r.event.damage.hpAfter, 0)
})

test("damage: rng is called exactly once per die", () => {
  const { rng, calls } = sequence(0.1, 0.2, 0.3)
  const r = applyDamage(state, { targetId: "p1", diceCount: 3, diceSides: 8, bonus: 0 }, rng)
  assert.ok(r.isOk)
  assert.equal(r.event.damage.rolls.length, 3)
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
    assert.deepEqual(lowest.event.damage.rolls, [1])
    assert.deepEqual(highest.event.damage.rolls, [diceSides])
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
  assert.equal(r.event.damage.hpAfter, 0)
  assert.equal(r.event.damage.outcome, "dead")
})

test("enemy that survives the damage is alive", () => {
  // d4 = 3
  const r = applyDamage(state, { targetId: "e1", diceCount: 1, diceSides: 4, bonus: 0 }, fixed(0.5))
  assert.ok(r.isOk)
  assert.equal(r.event.damage.hpAfter, 4)
  assert.equal(r.event.damage.outcome, "alive")
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
  const { damage, nextTurn, combatEnd, saveEvents, ...roll } = r.event
  // outside combat there are no turns and no combat to end
  assert.equal(nextTurn, null)
  assert.equal(combatEnd, null)
  assert.deepEqual(saveEvents, [])
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

test("death save: natural 20 regains consciousness with 1 HP and resets the counters", () => {
  const r = deathSave(
    withDownPlayer({ saveRollSuccesses: 2, saveRollFails: 2 }),
    saveP1,
    fixed(0.999),
  )
  assert.ok(r.isOk)
  assert.equal(r.event.roll, 20)
  assert.equal(r.event.outcome, "regainedConsciousness")
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
  assert.equal(r.event.damage.hpAfter, 9)
  assert.equal(r.event.damage.outcome, "alive")
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
  assert.equal(r.event.damage.hpAfter, 0)
  assert.equal(r.event.damage.outcome, "down")
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
  assert.equal(r.event.damage.hpBefore, 0)
  assert.equal(r.event.damage.hpAfter, 0)
  assert.equal(r.event.damage.outcome, "down")
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
  assert.equal(r.event.damage.outcome, "dead")
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
  assert.equal(r.event.damage.outcome, "down")
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
  assert.equal(r.event.damage.amount, 17)
  assert.equal(r.event.damage.hpAfter, 0)
  assert.equal(r.event.damage.outcome, "dead")
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
  assert.equal(r.event.damage.amount, 16)
  assert.equal(r.event.damage.outcome, "down")
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
  assert.equal(r.event.damage.amount, 12)
  assert.equal(r.event.damage.outcome, "dead")
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
  assert.equal(r.event.damage.amount, 11)
  assert.equal(r.event.damage.outcome, "down")
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

// ---------- healing ----------
// d4: 0 rolls 1, 0.5 rolls 3, 0.999 rolls 4; d8: 0.5 rolls 5

test("heal: raises HP, fills the event and does not mutate the original state", () => {
  const wounded = withPlayer({ hp: 4 })
  const r = applyHeal(wounded, { targetId: "p1", diceCount: 1, diceSides: 8, bonus: 2 }, fixed(0.5))
  assert.ok(r.isOk)
  assert.deepEqual(r.event, {
    targetId: "p1",
    targetName: "Арвен",
    amount: 7,
    rolls: [5],
    bonus: 2,
    hpBefore: 4,
    hpAfter: 11,
    outcome: "healed",
  })
  assert.equal(r.state.players[0].hp, 11)
  assert.equal(wounded.players[0].hp, 4)
})

test("heal: HP never exceeds max HP, amount is still the full roll", () => {
  // 2d4 + 2 = 4 + 4 + 2 = 10, but only 2 HP are missing
  const r = applyHeal(
    withPlayer({ hp: 10 }),
    { targetId: "p1", diceCount: 2, diceSides: 4, bonus: 2 },
    fixed(0.999),
  )
  assert.ok(r.isOk)
  assert.equal(r.event.amount, 10)
  assert.equal(r.event.hpAfter, 12)
  assert.equal(r.state.players[0].hp, 12)
})

test("heal: rng is called exactly once per die, no crits", () => {
  // three d20 rolls of 20 must not double anything
  const { rng, calls } = sequence(0.999, 0.999, 0.999)
  const r = applyHeal(
    withPlayer({ hp: 1 }),
    { targetId: "p1", diceCount: 3, diceSides: 20, bonus: 0 },
    rng,
  )
  assert.ok(r.isOk)
  assert.deepEqual(r.event.rolls, [20, 20, 20])
  assert.equal(r.event.amount, 60)
  assert.equal(calls(), 3)
})

test("heal: character at 0 HP regains consciousness and the death save counters reset", () => {
  const r = applyHeal(
    withDownPlayer({ saveRollFails: 2, saveRollSuccesses: 1 }),
    { targetId: "p1", diceCount: 1, diceSides: 4, bonus: 0 },
    fixed(0),
  )
  assert.ok(r.isOk)
  assert.equal(r.event.hpBefore, 0)
  assert.equal(r.event.hpAfter, 1)
  assert.equal(r.event.outcome, "regainedConsciousness")
  const p = r.state.players[0]
  assert.equal(p.hp, 1)
  assert.equal(p.saveRollFails, 0)
  assert.equal(p.saveRollSuccesses, 0)
  assert.equal(p.isStabilizedAfterSave, false)
})

test("heal: stable character regains consciousness and is no longer stable", () => {
  const r = applyHeal(
    withDownPlayer({ isStabilizedAfterSave: true }),
    { targetId: "p1", diceCount: 1, diceSides: 4, bonus: 0 },
    fixed(0.5),
  )
  assert.ok(r.isOk)
  assert.equal(r.event.outcome, "regainedConsciousness")
  assert.equal(r.state.players[0].hp, 3)
  assert.equal(r.state.players[0].isStabilizedAfterSave, false)
})

test("heal: healed character can act again", () => {
  const healed = applyHeal(
    withDownPlayer(),
    { targetId: "p1", diceCount: 1, diceSides: 4, bonus: 0 },
    fixed(0.5),
  )
  assert.ok(healed.isOk)
  const check = rollCheck(healed.state, { characterId: "p1", skill: "stealth", dc: 10 }, fixed(0.5))
  assert.ok(check.isOk)
})

test("heal: enemies can be healed, players stay untouched", () => {
  const r = applyHeal(
    withGoblin({ hp: 2 }),
    { targetId: "e1", diceCount: 1, diceSides: 4, bonus: 0 },
    fixed(0.5),
  )
  assert.ok(r.isOk)
  assert.equal(r.event.hpAfter, 5)
  assert.equal(r.event.outcome, "healed")
  assert.equal(r.state.enemies[0].hp, 5)
  assert.deepEqual(r.state.players, state.players)
})

test("heal: refusals roll nothing", () => {
  const dice = { diceCount: 1, diceSides: 4, bonus: 0 } as const
  const cases: [string, GameState, string][] = [
    ["unknown target", state, "ghost"],
    ["dead player", withDownPlayer({ saveRollFails: 3 }), "p1"],
    ["enemy at 0 HP", withGoblin({ hp: 0 }), "e1"],
  ]
  for (const [name, s, targetId] of cases) {
    const r = applyHeal(s, { targetId, ...dice }, sequence().rng)
    assert.equal(r.isOk, false, name)
  }
})

test("heal args schema: same dice limits as damage, flat args", () => {
  const schema = ToolArgsSchemas.apply_heal
  const valid = { targetId: "p1", diceCount: 2, diceSides: 4, bonus: 2 }
  assert.equal(schema.safeParse(valid).success, true)
  assert.equal(
    schema.safeParse({ targetId: "p1", diceCount: 10, diceSides: 20, bonus: 10 }).success,
    true,
  )
  const invalid = [
    { ...valid, diceCount: 0 },
    { ...valid, diceCount: 11 },
    { ...valid, diceSides: 7 },
    { ...valid, bonus: -1 },
    { ...valid, bonus: 11 },
    { targetId: "p1", amount: 50 },
    { targetId: "p1", dice: { diceCount: 2, diceSides: 4, bonus: 2 } },
  ]
  for (const args of invalid) {
    assert.equal(schema.safeParse(args).success, false, JSON.stringify(args))
  }
})

test("weapon schema: damage dice use the same limits", () => {
  const weapon = { id: "w", name: "W", attackBonus: 0 }
  const make = (damage: unknown) =>
    GameStateSchema.safeParse({
      ...state,
      players: [{ ...state.players[0], weapons: [{ ...weapon, damage }] }],
    }).success
  assert.equal(make({ diceCount: 1, diceSides: 6, bonus: 0 }), true)
  assert.equal(make({ diceCount: 11, diceSides: 6, bonus: 0 }), false)
  assert.equal(make({ diceCount: 1, diceSides: 7, bonus: 0 }), false)
  assert.equal(make({ diceCount: 1, diceSides: 6, bonus: 11 }), false)
})

// ---------- combat ----------

// The rng value that rolls n on a d20
const d20 = (n: number) => (n - 1) / 20 + 0.01

// Two players and two goblins: p1 +3, p2 -1, e1 +2, e2 +2
const ally: Player = { ...state.players[0], id: "p2", name: "Борин", initiativeModifier: -1 }
const archer = { ...state.enemies[0], id: "e2", name: "Гоблин-лучник" }
const crowd: GameState = {
  ...state,
  players: [...state.players, ally],
  enemies: [...state.enemies, archer],
}

const activeCombat = { order: ["p1", "e1"], round: 3, activeCreatureId: "e1" }

test("start combat: order by initiative total, highest first", () => {
  // p1 5+3=8, e1 15+2=17, p2 20-1=19, e2 3+2=5
  const { rng, calls } = sequence(d20(5), d20(15), d20(20), d20(3))
  const r = startCombat(crowd, { participantIds: ["p1", "e1", "p2", "e2"] }, rng)
  assert.ok(r.isOk)
  assert.equal(calls(), 4)
  assert.deepEqual(
    r.event.participantsOrder.map((p) => p.id),
    ["p2", "e1", "p1", "e2"],
  )
  assert.deepEqual(r.state.combat, {
    order: ["p2", "e1", "p1", "e2"],
    round: 1,
    activeCreatureId: "p2",
  })
})

test("start combat: event participants carry side, roll, modifier and total", () => {
  const { rng } = sequence(d20(5), d20(15), d20(20), d20(3))
  const r = startCombat(crowd, { participantIds: ["p1", "e1", "p2", "e2"] }, rng)
  assert.ok(r.isOk)
  assert.deepEqual(r.event.participantsOrder, [
    { id: "p2", name: "Борин", side: "player", roll: 20, initiativeModifier: -1, total: 19 },
    { id: "e1", name: "Гоблин-часовой", side: "enemy", roll: 15, initiativeModifier: 2, total: 17 },
    { id: "p1", name: "Арвен", side: "player", roll: 5, initiativeModifier: 3, total: 8 },
    { id: "e2", name: "Гоблин-лучник", side: "enemy", roll: 3, initiativeModifier: 2, total: 5 },
  ])
})

test("start combat: dice are rolled in the order of participantIds", () => {
  // the same rolls with the ids swapped give the other creature the 20
  const r = startCombat(state, { participantIds: ["e1", "p1"] }, sequence(d20(20), d20(1)).rng)
  assert.ok(r.isOk)
  const goblin = r.event.participantsOrder.find((p) => p.id === "e1")
  assert.equal(goblin?.roll, 20)
  assert.equal(r.state.combat?.activeCreatureId, "e1")
})

test("start combat: equal totals keep the order of participantIds", () => {
  // p1 10+3=13, e1 11+2=13
  const pFirst = startCombat(
    state,
    { participantIds: ["p1", "e1"] },
    sequence(d20(10), d20(11)).rng,
  )
  assert.ok(pFirst.isOk)
  assert.deepEqual(pFirst.state.combat?.order, ["p1", "e1"])

  const eFirst = startCombat(
    state,
    { participantIds: ["e1", "p1"] },
    sequence(d20(11), d20(10)).rng,
  )
  assert.ok(eFirst.isOk)
  assert.deepEqual(eFirst.state.combat?.order, ["e1", "p1"])
})

test("start combat: only the listed creatures join", () => {
  const r = startCombat(crowd, { participantIds: ["p1", "e1"] }, fixed(0.5))
  assert.ok(r.isOk)
  assert.deepEqual([...(r.state.combat?.order ?? [])].sort(), ["e1", "p1"])
  assert.equal(r.event.participantsOrder.length, 2)
})

test("start combat: a down but living player takes part", () => {
  const r = startCombat(withDownPlayer(), { participantIds: ["p1", "e1"] }, fixed(0.5))
  assert.ok(r.isOk)
  assert.ok(r.state.combat?.order.includes("p1"))
})

test("start combat: does not mutate the original state and keeps the creatures", () => {
  const before = structuredClone(crowd)
  const r = startCombat(crowd, { participantIds: ["p1", "e1"] }, fixed(0.5))
  assert.ok(r.isOk)
  assert.deepEqual(crowd, before)
  assert.equal(crowd.combat, null)
  assert.deepEqual(r.state.players, crowd.players)
  assert.deepEqual(r.state.enemies, crowd.enemies)
})

test("start combat: refusals roll nothing", () => {
  const cases: [string, GameState, string[]][] = [
    ["combat already active", { ...state, combat: activeCombat }, ["p1", "e1"]],
    ["unknown id", state, ["p1", "orc1"]],
    ["repeated id", crowd, ["p1", "e1", "e1"]],
    ["dead player", withDownPlayer({ saveRollFails: 3 }), ["p1", "e1"]],
    ["enemy at 0 HP", withGoblin({ hp: 0 }), ["p1", "e1"]],
    ["only enemies", crowd, ["e1", "e2"]],
    ["only players", crowd, ["p1", "p2"]],
  ]
  for (const [name, s, participantIds] of cases) {
    const r = startCombat(s, { participantIds }, sequence().rng)
    assert.equal(r.isOk, false, name)
  }
})

test("start combat: unknown id is named in the error", () => {
  const r = startCombat(state, { participantIds: ["p1", "orc1"] }, sequence().rng)
  assert.equal(r.isOk, false)
  assert.match(r.errorText, /orc1/)
})

test("start combat args schema: at least two ids", () => {
  const schema = ToolArgsSchemas.start_combat
  assert.equal(schema.safeParse({ participantIds: ["p1", "e1"] }).success, true)
  const invalid = [{}, { participantIds: [] }, { participantIds: ["p1"] }, { participantIds: "p1" }]
  for (const args of invalid) {
    assert.equal(schema.safeParse(args).success, false, JSON.stringify(args))
  }
})

test("end combat: removes the combat and reports the last round", () => {
  const s: GameState = { ...state, combat: activeCombat }
  const r = endCombat(s)
  assert.ok(r.isOk)
  assert.equal(r.state.combat, null)
  assert.deepEqual(r.event, { lastRound: 3 })
  assert.deepEqual(r.state.players, s.players)
  assert.deepEqual(r.state.enemies, s.enemies)
  assert.deepEqual(s.combat, activeCombat)
})

test("end combat: refused when no combat is active", () => {
  const r = endCombat(state)
  assert.equal(r.isOk, false)
})

test("start after end: a new combat can begin", () => {
  const ended = endCombat({ ...state, combat: activeCombat })
  assert.ok(ended.isOk)
  const r = startCombat(ended.state, { participantIds: ["p1", "e1"] }, fixed(0.5))
  assert.ok(r.isOk)
  assert.equal(r.state.combat?.round, 1)
})

// ---------- turns ----------

// The crowd in combat with the given order and active creature, round 1
function inCombat(order: string[], activeCreatureId: string, s: GameState = crowd): GameState {
  return { ...s, combat: { order, round: 1, activeCreatureId } }
}

// The crowd with some fields of one creature replaced
function crowdWith(id: string, patch: Partial<Player>): GameState {
  return {
    ...crowd,
    players: crowd.players.map((p) => (p.id === id ? { ...p, ...patch } : p)),
    enemies: crowd.enemies.map((e) => (e.id === id ? { ...e, ...patch } : e)),
  }
}

test("end turn: passes the turn to the next creature and fills the event", () => {
  const s = inCombat(["p1", "e1", "p2", "e2"], "p1")
  const r = endTurn(s, { creatureId: "p1" })
  assert.ok(r.isOk)
  assert.deepEqual(r.event, {
    creatureId: "p1",
    creatureName: "Арвен",
    nextTurn: {
      nextCreatureId: "e1",
      nextCreatureName: "Гоблин-часовой",
      round: 1,
      isNewRound: false,
    },
    combatEnd: null,
    saveEvents: [],
  })
  assert.deepEqual(r.state.combat, {
    order: ["p1", "e1", "p2", "e2"],
    round: 1,
    activeCreatureId: "e1",
  })
})

test("end turn: after the last creature the order starts over in a new round", () => {
  const s = inCombat(["p1", "e1", "p2", "e2"], "e2")
  const r = endTurn(s, { creatureId: "e2" })
  assert.ok(r.isOk)
  assert.equal(r.event.nextTurn?.nextCreatureId, "p1")
  assert.equal(r.event.nextTurn?.round, 2)
  assert.equal(r.event.nextTurn?.isNewRound, true)
  assert.equal(r.state.combat?.round, 2)
  assert.equal(r.state.combat?.activeCreatureId, "p1")
})

test("end turn: a whole round of turns comes back to the first creature", () => {
  let s = inCombat(["p1", "e1", "p2", "e2"], "p1")
  for (const id of ["p1", "e1", "p2", "e2"]) {
    const r = endTurn(s, { creatureId: id })
    assert.ok(r.isOk, id)
    s = r.state
  }
  assert.deepEqual(s.combat, { order: ["p1", "e1", "p2", "e2"], round: 2, activeCreatureId: "p1" })
})

test("end turn: an enemy at 0 HP is skipped", () => {
  const s = inCombat(["p1", "e1", "p2", "e2"], "p1", crowdWith("e1", { hp: 0 }))
  const r = endTurn(s, { creatureId: "p1" })
  assert.ok(r.isOk)
  assert.equal(r.event.nextTurn?.nextCreatureId, "p2")
  assert.equal(r.event.nextTurn?.isNewRound, false)
})

test("end turn: a dead player is skipped without a roll", () => {
  const dead = inCombat(["e1", "p1", "p2"], "e1", crowdWith("p1", { hp: 0, saveRollFails: 3 }))
  const skipped = endTurn(dead, { creatureId: "e1" }, sequence().rng)
  assert.ok(skipped.isOk)
  assert.equal(skipped.event.nextTurn?.nextCreatureId, "p2")
  assert.deepEqual(skipped.event.saveEvents, [])
})

test("end turn: skipping past the end of the order starts a new round", () => {
  // e2 is last and dead, so the turn of p1 goes over the end to e1
  const s = inCombat(["e1", "p1", "e2"], "p1", crowdWith("e2", { hp: 0 }))
  const r = endTurn(s, { creatureId: "p1" })
  assert.ok(r.isOk)
  assert.equal(r.event.nextTurn?.nextCreatureId, "e1")
  assert.equal(r.event.nextTurn?.round, 2)
  assert.equal(r.event.nextTurn?.isNewRound, true)
})

test("end turn: a creature that died on its own turn can still end it", () => {
  // p1 failed the third death save on its turn; p2 still fights
  const s = inCombat(["p1", "e1", "p2"], "p1", crowdWith("p1", { hp: 0, saveRollFails: 3 }))
  const r = endTurn(s, { creatureId: "p1" })
  assert.ok(r.isOk)
  assert.equal(r.event.nextTurn?.nextCreatureId, "e1")
})

test("end turn: does not mutate the original state and keeps the creatures", () => {
  const s = inCombat(["p1", "e1"], "p1")
  const before = structuredClone(s)
  const r = endTurn(s, { creatureId: "p1" })
  assert.ok(r.isOk)
  assert.deepEqual(s, before)
  assert.deepEqual(r.state.players, s.players)
  assert.deepEqual(r.state.enemies, s.enemies)
})

test("end turn: refusals", () => {
  const cases: [string, GameState, string][] = [
    ["no combat", crowd, "p1"],
    ["not the active creature", inCombat(["p1", "e1"], "p1"), "e1"],
    ["unknown id", inCombat(["p1", "e1"], "p1"), "orc1"],
    ["unknown id in the order", inCombat(["p1", "orc1", "e1"], "p1"), "p1"],
  ]
  for (const [name, s, creatureId] of cases) {
    const r = endTurn(s, { creatureId })
    assert.equal(r.isOk, false, name)
    assert.ok(!r.isOk && r.errorText.length > 0, name)
  }
})

// A combat with one side left cannot be reached through the engine (every action that kills
// closes it), only through a broken state. These two tests pin down what end_turn does then.

test("end turn: a combat already left with one side, two creatures still up: closed", () => {
  // e1 and e2 are dead, p1 and p2 are up: the turn passes to p2 and the combat closes
  const s = inCombat(["p1", "e1", "p2", "e2"], "p1", {
    ...crowd,
    enemies: crowd.enemies.map((e) => ({ ...e, hp: 0 })),
  })
  const r = endTurn(s, { creatureId: "p1" }, sequence().rng)
  assert.ok(r.isOk)
  assert.equal(r.state.combat, null)
  assert.deepEqual(r.event.combatEnd, { lastRound: 1 })
  assert.equal(r.event.nextTurn, null)
})

test("end turn: a combat already left with one side, a single creature up: refused", () => {
  // nobody to pass the turn to; end_combat still closes it
  const s = inCombat(["p1", "e1"], "p1", crowdWith("e1", { hp: 0 }))
  const r = endTurn(s, { creatureId: "p1" }, sequence().rng)
  assert.equal(r.isOk, false)
  assert.ok(endCombat(s).isOk)
})

test("end turn args schema: creature id is required", () => {
  const schema = ToolArgsSchemas.end_turn
  assert.equal(schema.safeParse({ creatureId: "p1" }).success, true)
  assert.equal(schema.safeParse({}).success, false)
  assert.equal(schema.safeParse({ creatureId: 1 }).success, false)
})

test("turns: in combat only the active creature can attack, nothing is rolled otherwise", () => {
  const s = inCombat(["p1", "e1"], "e1")
  const r = attack(s, daggerAtGoblin, sequence().rng)
  assert.equal(r.isOk, false)
  assert.match(r.errorText, /e1/)

  const own = attack(inCombat(["p1", "e1"], "p1"), daggerAtGoblin, sequence(0.5, 0.5).rng)
  assert.ok(own.isOk)
})

test("turns: outside combat anyone can attack, including an ally", () => {
  const r = attack(crowd, { attackerId: "p2", weaponId: "dagger", targetId: "p1" }, fixed(0.5))
  assert.ok(r.isOk)
})

test("turns: death_save is refused in combat, even on the character's own turn, nothing is rolled", () => {
  const down = crowdWith("p1", { hp: 0 })
  for (const active of ["p1", "e1"]) {
    const r = deathSave(inCombat(["p1", "e1"], active, down), saveP1, sequence().rng)
    assert.equal(r.isOk, false, active)
    // the text tells the model the save is automatic
    assert.match(r.isOk ? "" : r.errorText, /automatic/, active)
  }
})

// ---------- turn passing by actions ----------
// attack and death_save end the turn themselves; end_turn is only for turns without them

const scimitarAtArwen = { attackerId: "e1", weaponId: "scimitar", targetId: "p1" }

test("turn passing: a hit in combat passes the turn and the event tells who is next", () => {
  // d20 = 11, 16 vs AC 15; d4 = 3: e1 7 -> 1, still standing
  const s = inCombat(["p1", "e1", "p2", "e2"], "p1")
  const r = attack(s, daggerAtGoblin, sequence(0.5, 0.5).rng)
  assert.ok(r.isOk)
  assert.deepEqual(r.event.nextTurn, {
    nextCreatureId: "e1",
    nextCreatureName: "Гоблин-часовой",
    round: 1,
    isNewRound: false,
  })
  assert.equal(r.event.combatEnd, null)
  assert.deepEqual(r.event.saveEvents, [])
  assert.deepEqual(r.state.combat, {
    order: ["p1", "e1", "p2", "e2"],
    round: 1,
    activeCreatureId: "e1",
  })
  assert.equal(r.state.enemies[0].hp, 1)
})

test("turn passing: a miss passes the turn too", () => {
  // natural 1
  const s = inCombat(["p1", "e1"], "p1")
  const r = attack(s, daggerAtGoblin, sequence(0).rng)
  assert.ok(r.isOk)
  assert.equal(r.event.hasHit, false)
  assert.equal(r.event.nextTurn?.nextCreatureId, "e1")
  assert.equal(r.state.combat?.activeCreatureId, "e1")
})

test("turn passing: a creature killed by the attack is skipped", () => {
  // e1 at 1 HP dies from the hit, so the turn goes past it to p2
  const s = inCombat(["p1", "e1", "p2", "e2"], "p1", crowdWith("e1", { hp: 1 }))
  const r = attack(s, daggerAtGoblin, sequence(0.5, 0.5).rng)
  assert.ok(r.isOk)
  assert.equal(r.event.damage?.outcome, "dead")
  assert.equal(r.event.nextTurn?.nextCreatureId, "p2")
  assert.equal(r.state.combat?.activeCreatureId, "p2")
})

test("turn passing: an attack by the last creature in the order starts a new round", () => {
  // d20 = 11, 15 vs AC 14; d6 = 4, 4 + 2 = 6
  const s = inCombat(["p1", "e1"], "e1")
  const r = attack(s, scimitarAtArwen, fixed(0.5))
  assert.ok(r.isOk)
  assert.deepEqual(r.event.nextTurn, {
    nextCreatureId: "p1",
    nextCreatureName: "Арвен",
    round: 2,
    isNewRound: true,
  })
  assert.deepEqual(r.state.combat, { order: ["p1", "e1"], round: 2, activeCreatureId: "p1" })
})

test("turn passing: an attack outside combat has no turn, no combat end and starts no combat", () => {
  const r = attack(state, daggerAtGoblin, fixed(0))
  assert.ok(r.isOk)
  assert.equal(r.event.nextTurn, null)
  assert.equal(r.event.combatEnd, null)
  assert.deepEqual(r.event.saveEvents, [])
  assert.equal(r.state.combat, null)
})

// ---------- combat ends by itself ----------

test("combat end: killing the last enemy closes the combat and passes no turn", () => {
  // e2 is not in this fight; e1 at 1 HP dies (d20 = 11, 16 vs AC 15; d4 = 3)
  const s = inCombat(["p1", "e1"], "p1", crowdWith("e1", { hp: 1 }))
  const r = attack(s, daggerAtGoblin, sequence(0.5, 0.5).rng)
  assert.ok(r.isOk)
  assert.equal(r.event.damage?.outcome, "dead")
  assert.deepEqual(r.event.combatEnd, { lastRound: 1 })
  assert.equal(r.event.nextTurn, null)
  assert.deepEqual(r.event.saveEvents, [])
  assert.equal(r.state.combat, null)
  // nothing to end any more
  assert.equal(endCombat(r.state).isOk, false)
})

test("combat end: the event has the same shape as end_combat", () => {
  const killed = attack(
    inCombat(["p1", "e1"], "p1", crowdWith("e1", { hp: 1 })),
    daggerAtGoblin,
    sequence(0.5, 0.5).rng,
  )
  const ended = endCombat(inCombat(["p1", "e1"], "p1"))
  assert.ok(killed.isOk && ended.isOk)
  assert.deepEqual(killed.event.combatEnd, ended.event)
})

test("combat end: a dying ally next in the order does not roll after the last enemy falls", () => {
  // order [p1, e1, p2]: p2 is down, but the fight ends on p1's hit, so no save is rolled
  const s = inCombat(["p1", "e1", "p2"], "p1", crowdWith("e1", { hp: 1 }))
  const down: GameState = {
    ...s,
    players: s.players.map((p) => (p.id === "p2" ? { ...p, hp: 0 } : p)),
  }
  const { rng, calls } = sequence(0.5, 0.5)
  const r = attack(down, daggerAtGoblin, rng)
  assert.ok(r.isOk)
  assert.equal(calls(), 2)
  assert.deepEqual(r.event.saveEvents, [])
  assert.equal(r.state.combat, null)
  assert.equal(r.state.players[1].saveRollFails, 0)
})

test("combat end: a hit that leaves both sides keeps the combat", () => {
  const s = inCombat(["p1", "e1"], "p1")
  const r = attack(s, daggerAtGoblin, sequence(0.5, 0.5).rng)
  assert.ok(r.isOk)
  assert.equal(r.event.combatEnd, null)
  assert.notEqual(r.state.combat, null)
})

test("combat end: a death save after an attack that kills the last character closes the combat", () => {
  // the goblin misses (natural 1), the turn passes to Arwen at 2 failures, she fails the save
  const { rng, calls } = sequence(0, d20(5))
  const r = attack(arwenDown({ saveRollFails: 2 }), scimitarAtArwen, rng)
  assert.ok(r.isOk)
  assert.equal(r.event.hasHit, false)
  assert.equal(r.event.saveEvents.length, 1)
  assert.equal(r.event.saveEvents[0].outcome, "dead")
  assert.equal(r.event.nextTurn, null)
  // the turn reached Arwen past the end of the order, so the fight ended in round 2
  assert.deepEqual(r.event.combatEnd, { lastRound: 2 })
  assert.equal(r.state.combat, null)
  assert.equal(calls(), 2)
})

test("combat end: apply_damage that kills the last enemy closes the combat", () => {
  // 10d20 + 10 on 7 HP
  const s = inCombat(["p1", "e1"], "p1")
  const r = applyDamage(
    s,
    { targetId: "e1", diceCount: 10, diceSides: 20, bonus: 10 },
    fixed(0.999),
  )
  assert.ok(r.isOk)
  assert.equal(r.event.damage.outcome, "dead")
  assert.deepEqual(r.event.combatEnd, { lastRound: 1 })
  assert.equal(r.state.combat, null)
})

test("combat end: apply_damage that kills the last character closes the combat", () => {
  // Arwen at 0 HP with 2 failures: one more is death
  const r = applyDamage(
    arwenDown({ saveRollFails: 2 }),
    { targetId: "p1", diceCount: 1, diceSides: 4, bonus: 0 },
    fixed(0),
  )
  assert.ok(r.isOk)
  assert.equal(r.event.damage.outcome, "dead")
  assert.deepEqual(r.event.combatEnd, { lastRound: 1 })
  assert.equal(r.state.combat, null)
})

test("combat end: apply_damage in combat that leaves both sides keeps the combat and the turn", () => {
  const s = inCombat(["p1", "e1"], "p1")
  const r = applyDamage(s, { targetId: "e1", diceCount: 1, diceSides: 4, bonus: 0 }, fixed(0))
  assert.ok(r.isOk)
  assert.equal(r.event.combatEnd, null)
  assert.deepEqual(r.state.combat, s.combat)
})

test("combat end: apply_damage outside combat has no combat end", () => {
  const r = applyDamage(
    state,
    { targetId: "e1", diceCount: 10, diceSides: 20, bonus: 10 },
    fixed(0.999),
  )
  assert.ok(r.isOk)
  assert.equal(r.event.combatEnd, null)
  assert.equal(r.state.combat, null)
})

test("combat end: end_combat still ends a fight where both sides are up", () => {
  // fleeing or surrender: the engine cannot see it, the model ends the combat
  const r = endCombat(inCombat(["p1", "e1"], "p1"))
  assert.ok(r.isOk)
  assert.equal(r.state.combat, null)
})

test("turn passing: an attack refused in combat changes nothing", () => {
  // unknown weapon: refused before any roll
  const s = inCombat(["p1", "e1"], "p1")
  const r = attack(s, { ...daggerAtGoblin, weaponId: "axe" }, sequence().rng)
  assert.equal(r.isOk, false)
  assert.equal(s.combat?.activeCreatureId, "p1")
})

test("turn passing: a death save outside combat passes no turn and has no turn field", () => {
  const r = deathSave(withDownPlayer(), saveP1, fixed(0.5))
  assert.ok(r.isOk)
  assert.equal("nextTurn" in r.event, false)
  assert.equal(r.state.combat, null)
})

// ---------- automatic death saves when the turn passes ----------
// Arwen (p1) is down in a fight with the goblin: order [p1, e1], the goblin's turn

const arwenDown = (patch: Partial<Player> = {}) =>
  inCombat(["p1", "e1"], "e1", crowdWith("p1", { hp: 0, ...patch }))

test("auto death save: the turn of a dying character rolls the save and goes on", () => {
  const { rng, calls } = sequence(d20(15))
  const r = endTurn(arwenDown(), { creatureId: "e1" }, rng)
  assert.ok(r.isOk)
  assert.deepEqual(r.event.nextTurn, {
    nextCreatureId: "e1",
    nextCreatureName: "Гоблин-часовой",
    round: 2,
    isNewRound: true,
  })
  assert.deepEqual(r.event.saveEvents, [
    {
      characterId: "p1",
      characterName: "Арвен",
      roll: 15,
      successes: 1,
      failures: 0,
      outcome: "success",
    },
  ])
  assert.equal(r.event.combatEnd, null)
  assert.deepEqual(r.state.combat, { order: ["p1", "e1"], round: 2, activeCreatureId: "e1" })
  assert.equal(r.state.players[0].saveRollSuccesses, 1)
  assert.equal(r.state.players[0].hp, 0)
  assert.equal(calls(), 1)
})

test("auto death save: a failure is recorded and the turn goes on", () => {
  const r = endTurn(arwenDown({ saveRollFails: 1 }), { creatureId: "e1" }, sequence(d20(5)).rng)
  assert.ok(r.isOk)
  assert.equal(r.event.nextTurn?.nextCreatureId, "e1")
  assert.equal(r.event.saveEvents[0].outcome, "failure")
  assert.equal(r.state.players[0].saveRollFails, 2)
})

test("auto death save: a natural 20 wakes the character and keeps the turn with them", () => {
  const r = endTurn(arwenDown({ saveRollFails: 2 }), { creatureId: "e1" }, sequence(d20(20)).rng)
  assert.ok(r.isOk)
  assert.equal(r.event.nextTurn?.nextCreatureId, "p1")
  assert.equal(r.event.nextTurn?.round, 2)
  assert.equal(r.event.nextTurn?.isNewRound, true)
  assert.equal(r.event.combatEnd, null)
  assert.equal(r.event.saveEvents[0].outcome, "regainedConsciousness")
  // the state agrees with the event: Arwen is up and it is her turn
  assert.deepEqual(r.state.combat, { order: ["p1", "e1"], round: 2, activeCreatureId: "p1" })
  assert.equal(r.state.players[0].hp, 1)
  // she acts at once, and her attack passes the turn back to the goblin
  const hit = attack(r.state, daggerAtGoblin, sequence(0.5, 0.5).rng)
  assert.ok(hit.isOk)
  assert.equal(hit.state.combat?.activeCreatureId, "e1")
})

test("auto death save: three successes stabilize, the turn goes on", () => {
  const r = endTurn(
    arwenDown({ saveRollSuccesses: 2 }),
    { creatureId: "e1" },
    sequence(d20(12)).rng,
  )
  assert.ok(r.isOk)
  assert.equal(r.event.saveEvents[0].outcome, "stable")
  assert.equal(r.event.nextTurn?.nextCreatureId, "e1")
  assert.equal(r.state.players[0].isStabilizedAfterSave, true)
})

test("auto death save: a save that kills the last character closes the combat", () => {
  const before = arwenDown({ saveRollFails: 2 })
  const r = endTurn(before, { creatureId: "e1" }, sequence(d20(5)).rng)
  assert.ok(r.isOk)
  // the save is reported even though nobody gets the next turn
  assert.equal(r.event.saveEvents.length, 1)
  assert.equal(r.event.saveEvents[0].outcome, "dead")
  assert.equal(r.event.nextTurn, null)
  assert.deepEqual(r.event.combatEnd, { lastRound: 2 })
  assert.equal(r.state.combat, null)
  assert.equal(r.state.players[0].saveRollFails, 3)
})

test("auto death save: a stable character is skipped without a roll", () => {
  const r = endTurn(
    arwenDown({ isStabilizedAfterSave: true }),
    { creatureId: "e1" },
    sequence().rng,
  )
  assert.ok(r.isOk)
  assert.equal(r.event.nextTurn?.nextCreatureId, "e1")
  assert.equal(r.event.nextTurn?.round, 2)
  assert.deepEqual(r.event.saveEvents, [])
  assert.equal(r.state.players[0].isStabilizedAfterSave, true)
})

test("auto death save: two dying characters in a row both roll, in turn order", () => {
  const both: GameState = {
    ...crowd,
    players: crowd.players.map((p) => ({ ...p, hp: 0 })),
    combat: { order: ["e1", "p1", "p2"], round: 1, activeCreatureId: "e1" },
  }
  const { rng, calls } = sequence(d20(15), d20(5))
  const r = endTurn(both, { creatureId: "e1" }, rng)
  assert.ok(r.isOk)
  assert.deepEqual(
    r.event.saveEvents.map((e) => [e.characterId, e.outcome]),
    [
      ["p1", "success"],
      ["p2", "failure"],
    ],
  )
  assert.equal(r.event.nextTurn?.nextCreatureId, "e1")
  assert.equal(r.event.nextTurn?.round, 2)
  assert.equal(r.state.players[0].saveRollSuccesses, 1)
  assert.equal(r.state.players[1].saveRollFails, 1)
  assert.equal(calls(), 2)
})

test("auto death save: a new round that starts after the save is still counted", () => {
  // the goblin passes to p2 (dying, no new round), then over the end of the order to p1
  const s = inCombat(["p1", "e1", "p2"], "e1", crowdWith("p2", { hp: 0 }))
  const r = endTurn(s, { creatureId: "e1" }, sequence(d20(15)).rng)
  assert.ok(r.isOk)
  assert.equal(r.event.nextTurn?.nextCreatureId, "p1")
  assert.equal(r.event.nextTurn?.round, 2)
  assert.equal(r.event.nextTurn?.isNewRound, true)
  assert.deepEqual(r.state.combat, { order: ["p1", "e1", "p2"], round: 2, activeCreatureId: "p1" })
})

test("auto death save: an attack passes the turn the same way", () => {
  // the goblin hits Arwen at 0 HP (d20 11 + 4 = 15 vs AC 14, d6 = 4): one failure from damage,
  // then her turn comes and she rolls the save (15): a success
  const { rng, calls } = sequence(0.5, 0.5, d20(15))
  const r = attack(arwenDown(), scimitarAtArwen, rng)
  assert.ok(r.isOk)
  assert.equal(r.event.damage?.outcome, "down")
  assert.equal(r.event.nextTurn?.nextCreatureId, "e1")
  assert.equal(r.event.nextTurn?.round, 2)
  assert.equal(r.event.saveEvents[0].outcome, "success")
  assert.equal(r.state.players[0].saveRollFails, 1)
  assert.equal(r.state.players[0].saveRollSuccesses, 1)
  assert.equal(calls(), 3)
})

test("auto death save: the original state is not mutated", () => {
  const s = arwenDown()
  const before = structuredClone(s)
  const r = endTurn(s, { creatureId: "e1" }, sequence(d20(15)).rng)
  assert.ok(r.isOk)
  assert.deepEqual(s, before)
})

test("state schema: combat is required, null or a valid combat", () => {
  assert.equal(GameStateSchema.safeParse({ ...state, combat: null }).success, true)
  assert.equal(GameStateSchema.safeParse({ ...state, combat: activeCombat }).success, true)
  const { combat: _omitted, ...withoutCombat } = state
  const invalid = [
    withoutCombat,
    { ...state, combat: { ...activeCombat, order: [] } },
    { ...state, combat: { ...activeCombat, round: 0 } },
    { ...state, combat: { order: ["p1"], round: 1 } },
  ]
  invalid.forEach((s, i) => {
    assert.equal(GameStateSchema.safeParse(s).success, false, `invalid case ${i}`)
  })
})

test("state schema: initiative modifier is an integer from -5 to 10", () => {
  const make = (initiativeModifier: unknown) =>
    GameStateSchema.safeParse({
      ...state,
      players: [{ ...state.players[0], initiativeModifier }],
    }).success
  assert.equal(make(-5), true)
  assert.equal(make(10), true)
  assert.equal(make(-6), false)
  assert.equal(make(11), false)
  assert.equal(make(1.5), false)
  assert.equal(make(undefined), false)
})
