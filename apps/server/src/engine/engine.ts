import {
  GameState,
  RollCheckArgs,
  ApplyDamageArgs,
  ReturnResult, AttackArg, DamageEvent, Creature, AttackEvent, DeathSaveArgs, DeathOutcomeType, Character,
  DamageOutcome, Enemy,
} from "@dnd/shared"

// Random number generator in [0, 1). Math.random in the game, replaced in tests.
export type Rng = () => number
interface RollAndApplyDamageResult {
  state: GameState
  event: DamageEvent
}

export function rollD(rng: Rng = Math.random, sides: number): number {
  return Math.floor(rng() * sides) + 1
}

function changeCreatureInList<T extends Creature>(list: T[], creature: T): T[] {
  return list.map(c => {
    if (c.id !== creature.id) return c
    return creature
  })
}

function isPlayerDead(player: Character): boolean {
  return player.saveRollFails === 3
}

function getDamageTargetError(target: Character | Enemy): string | null {
  if("saveRollFails" in target) {
    if(isPlayerDead(target)) return `${target.name} is already dead`
  } else {
    if(target.hp === 0) return `${target.name} is already dead`
  }

  return null
}

function rollAndApplyDamage(
  state: GameState, target: Creature, diceCount: number, diceSides: number,
  bonus: number, isCritical: boolean, rng: Rng
): RollAndApplyDamageResult {
  let players, enemies
  const hpBefore = target.hp
  let amount = bonus
  const rolls: number[] = []
  const diceCountConsideringCrit = isCritical ? diceCount * 2 : diceCount

  for(let i = 0; i < diceCountConsideringCrit; i++) {
    const roll = rollD(rng, diceSides)
    rolls.push(roll)
    amount += roll
  }

  const hpAfter = Math.max(0, target.hp - amount)
  const event: Omit<DamageEvent, "outcome"> = {
    targetId: target.id,
    targetName: target.name,
    amount,
    rolls,
    bonus,
    hpBefore,
    hpAfter,
  }
  let outcome: DamageOutcome

  const player = state.players.find(player => player.id === target.id)
  if(player) {  // logic for player
    let newPlayerState: Character
    const isInstantDeath = player.maxHp + player.hp <= amount
    // logic for downed player
    if(player.hp === 0) {
      const saveRollFailsChange = isCritical ? 2 : 1
      const saveRollFails = isInstantDeath ? 3 :
        Math.min(3, player.saveRollFails + saveRollFailsChange)
      newPlayerState = {...player, saveRollFails, isStabilizedAfterSave: false}
      outcome = isPlayerDead(newPlayerState) ? "dead" : "down"
    } else {
      if(isInstantDeath) {
        outcome = "dead"
        newPlayerState = {...player, hp: hpAfter, saveRollFails: 3}
      } else {
        outcome = hpAfter > 0 ? "alive" : "down"
        newPlayerState = {...player, hp: hpAfter, saveRollSuccesses: 0, saveRollFails: 0, isStabilizedAfterSave: false}
      }
    }

    players = changeCreatureInList(state.players, newPlayerState)
    enemies = state.enemies
  } else {  // logic for enemies
    players = state.players
    const enemy = state.enemies.find(enemy => enemy.id === target.id)
    if(!enemy) throw new Error(`There is no enemy with id ${target.id}`)
    outcome = hpAfter > 0 ? "alive" : "dead"
    enemies = changeCreatureInList(state.enemies, {...enemy, hp: hpAfter})
  }
  return {
    state: {
      ...state,
      players,
      enemies,
    },
    event: {...event, outcome}
  }
}

export function rollCheck(state: GameState, args: RollCheckArgs, rng: Rng = Math.random): ReturnResult<"roll_check"> {
  const character = state.players.find((p) => p.id === args.characterId)
  if(!character) return {isOk: false, errorText: `Unknown character: ${args.characterId}`}
  if(character.hp === 0) return {isOk: false, errorText: `Character is down: ${character.name}`}

  // a skill missing from the sheet is untrained: modifier 0
  const modifier = character.skills[args.skill] ?? 0
  const roll = rollD(rng, 20)
  const total = roll + modifier
  return {
    isOk: true,
    event: {
      characterId: character.id,
      characterName: character.name,
      skill: args.skill,
      roll,
      modifier,
      total,
      dc: args.dc,
      success: total >= args.dc,
    },
    state
  }
}

/**
 * Damage without an attack roll: traps, falls, environmental hazards.
 * Always hits, never crits. Dice and bonus come from the model, limited by the args schema.
 */
export function applyDamage(state: GameState, args: ApplyDamageArgs, rng: Rng = Math.random): ReturnResult<"apply_damage"> {
  const {targetId, diceCount, diceSides, bonus} = args
  const target =
    state.players.find((p) => p.id === targetId)
    ?? state.enemies.find((e) => e.id === targetId)
  if (!target) return {isOk: false, errorText: `Unknown target: ${targetId}`}

  const targetError = getDamageTargetError(target)
  if(targetError) return {isOk: false, errorText: targetError}

  const result = rollAndApplyDamage(state, target, diceCount, diceSides, bonus, false, rng)
  return {
    isOk: true,
    event: result.event,
    state: result.state
  }
}

/**
 * Weapon attack: d20 + weapon attack bonus against target AC, then weapon damage on hit.
 * Natural 20 is a critical hit (dice count doubled), natural 1 always misses.
 * The model only picks attacker, weapon and target; all numbers come from the state.
 */
export function attack(state: GameState, args: AttackArg, rng: Rng = Math.random): ReturnResult<"attack"> {
  const attacker =
    state.players.find((p) => p.id === args.attackerId)
    ?? state.enemies.find((e) => e.id === args.attackerId)
  if(!attacker) return {isOk: false, errorText: `Unknown attacker with id: ${args.attackerId}`}

  const target =
    state.players.find((p) => p.id === args.targetId)
    ?? state.enemies.find((e) => e.id === args.targetId)
  if(!target) return {isOk: false, errorText: `Unknown target with id: ${args.targetId}`}

  const targetError = getDamageTargetError(target)
  if(targetError) return {isOk: false, errorText: targetError}

  const weapon = attacker.weapons.find(w => w.id === args.weaponId)
  if(!weapon) return {isOk: false, errorText: `Unknown weapon with id: ${args.weaponId}`}
  if(attacker.hp === 0) return {isOk: false, errorText: `Attacker is down: ${attacker.name}`}

  const roll = rollD(rng, 20)
  let damageEvent: DamageEvent | null, nextState: GameState
  const total = roll + weapon.attackBonus
  const isCritical = roll === 20
  const hasHit = roll === 20 ? true : roll === 1 ? false : total >= target.armorClass
  const event: Omit<AttackEvent, "damage"> = {
    attackerId: attacker.id,
    attackerName: attacker.name,
    targetId: target.id,
    targetName: target.name,
    weaponId: weapon.id,
    weaponName: weapon.name,
    targetArmorClass: target.armorClass,
    roll,
    attackBonus: weapon.attackBonus,
    total,
    hasHit,
    isCritical,
  }

  if(hasHit) {
    const damageResult = rollAndApplyDamage(state, target, weapon.damage.diceCount, weapon.damage.diceSides, weapon.damage.bonus, isCritical, rng)
    nextState = damageResult.state
    damageEvent = damageResult.event
  } else {
    nextState = state
    damageEvent = null
  }

  return {
    isOk: true,
    event: {
      ...event,
      damage: damageEvent,
    },
    state: nextState
  }
}

export function deathSave(state: GameState, args: DeathSaveArgs, rng: Rng = Math.random): ReturnResult<"death_save"> {
  const character = state.players.find((p) => p.id === args.characterId)
  if(!character) return {isOk: false, errorText: `Unknown character: ${args.characterId}`}
  if(character.hp > 0) return {isOk: false, errorText: `Character ${character.name} has HP`}
  if(isPlayerDead(character)) return {isOk: false, errorText: `Character is dead: ${character.name}`}
  if(character.isStabilizedAfterSave) return {isOk: false, errorText: `Character ${character.name} is stabilized`}

  const roll = rollD(rng, 20)
  let currentSuccesses = character.saveRollSuccesses
  let currentFailures = character.saveRollFails
  let outcome: DeathOutcomeType
  let isStabilizedAfterSave = false
  let hp = 0

  if(roll === 20) {
    hp = 1
    outcome = "revived"
    currentSuccesses = 0
    currentFailures = 0
  } else if(roll === 1) {
    currentFailures = Math.min(3, currentFailures + 2)
    outcome = "failure"
  } else if(roll >= 10) {
    currentSuccesses += 1
    outcome = "success"
  } else {
    currentFailures += 1
    outcome = "failure"
  }

  if(currentSuccesses === 3) {
    outcome = "stable"
    isStabilizedAfterSave = true
    currentSuccesses = 0
    currentFailures = 0
  }

  if(currentFailures === 3) {
    outcome = "dead"
  }

  const event = {
    characterId: character.id,
    characterName: character.name,
    roll,
    successes: currentSuccesses,
    failures: currentFailures,
    outcome,
  }

  const players = changeCreatureInList(
    state.players,
    {
      ...character,
      saveRollFails: currentFailures,
      saveRollSuccesses: currentSuccesses,
      isStabilizedAfterSave,
      hp
    }
  )

  return {
    isOk: true,
    event,
    state: {
      ...state,
      players
    }
  }
}
