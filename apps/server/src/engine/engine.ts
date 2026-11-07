import type {
  GameState,
  RollCheckArgs,
  ApplyDamageArgs,
  ReturnResult, AttackArg, DamageEvent, Creature, AttackEvent,
} from "@dnd/shared";

// Random number generator in [0, 1). Math.random in the game, replaced in tests.
export type Rng = () => number
interface RollAndApplyDamageResult {
  state: GameState
  event: DamageEvent
}

export function rollD(rng: Rng = Math.random, sides: number): number {
  return Math.floor(rng() * sides) + 1
}

function setHpOfCreature<T extends Creature>(list: T[], creatureId: string, hp: number): T[] {
  return list.map(c => {
    if (c.id !== creatureId) return c
    return {...c, hp}
  })
}

function rollAndApplyDamage(state: GameState, target: Creature, diceCount: number, diceSides: number, bonus: number, rng: Rng): RollAndApplyDamageResult {
  const hpBefore = target.hp
  let amount = bonus
  const rolls: number[] = []

  for(let i = 0; i < diceCount; i++) {
    const roll = rollD(rng, diceSides)
    rolls.push(roll)
    amount += roll
  }

  const hpAfter = Math.max(0, target.hp - amount)
  return {
    state: {
      ...state,
      players: setHpOfCreature(state.players, target.id, hpAfter),
      enemies: setHpOfCreature(state.enemies, target.id, hpAfter),
    },
    event: {
      targetId: target.id,
      targetName: target.name,
      amount,
      rolls,
      bonus,
      hpBefore,
      hpAfter,
      isDefeated: hpAfter === 0,
    }
  }
}

export function rollCheck(state: GameState, args: RollCheckArgs, rng: Rng = Math.random): ReturnResult<"roll_check"> {
  const character = state.players.find((p) => p.id === args.characterId)
  if (!character) return {isOk: false, errorText: `Unknown character: ${args.characterId}`}

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

export function applyDamage(state: GameState, args: ApplyDamageArgs, rng: Rng = Math.random): ReturnResult<"apply_damage"> {
  const {targetId, diceCount, diceSides, bonus} = args
  const target =
    state.players.find((p) => p.id === targetId)
    ?? state.enemies.find((e) => e.id === targetId)
  if (!target) return {isOk: false, errorText: `Unknown target: ${targetId}`}

  const result = rollAndApplyDamage(state, target, diceCount, diceSides, bonus, rng)
  return {
    isOk: true,
    event: result.event,
    state: result.state
  }
}

export function attack(state: GameState, args: AttackArg, rng: Rng = Math.random): ReturnResult<"attack"> {
  const attacker =
    state.players.find((p) => p.id === args.attackerId)
    ?? state.enemies.find((e) => e.id === args.attackerId)
  if(!attacker) return {isOk: false, errorText: `Unknown attacker with id: ${args.attackerId}`}

  const target =
    state.players.find((p) => p.id === args.targetId)
    ?? state.enemies.find((e) => e.id === args.targetId)
  if(!target) return {isOk: false, errorText: `Unknown target with id: ${args.targetId}`}

  const weapon = attacker.weapons.find(w => w.id === args.weaponId)
  if(!weapon) return {isOk: false, errorText: `Unknown weapon with id: ${args.weaponId}`}
  if(attacker.hp === 0) return {isOk: false, errorText: `Attacker is down: ${attacker.name}`}
  if(target.hp === 0) return {isOk: false, errorText: `Target is down: ${target.name}`}

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
    const diceCount = isCritical ? 2 * weapon.damage.diceCount : weapon.damage.diceCount
    const damageResult = rollAndApplyDamage(state, target, diceCount, weapon.damage.diceSides, weapon.damage.bonus, rng)
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
