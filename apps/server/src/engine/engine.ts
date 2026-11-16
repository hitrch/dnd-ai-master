import {
  GameState,
  RollCheckArgs,
  ApplyDamageArgs,
  ReturnResult,
  AttackArgs,
  DamageEvent,
  Creature,
  AttackEvent,
  DeathSaveArgs,
  DeathOutcomeType,
  Character,
  DamageOutcome,
  Enemy,
  ApplyHealArgs,
  Dice,
  HealEvent,
  StartCombatArgs,
  CombatParticipant,
  EndTurnArgs,
  EngineError,
  Combat,
  DeathSaveEvent,
  TurnPass,
} from "@dnd/shared"

// Random number generator in [0, 1). Math.random in the game, replaced in tests.
export type Rng = () => number
interface RollAndApplyDamageResult {
  state: GameState
  event: DamageEvent
}

type TurnPassResult =
  | {
      state: GameState
      nextTurn: TurnPass
    }
  | EngineError

export function rollD(rng: Rng, sides: number): number {
  return Math.floor(rng() * sides) + 1
}

function rollDice(diceInfo: Dice, rng: Rng): { rolls: number[]; amount: number } {
  const rolls: number[] = []
  let amount = diceInfo.bonus
  for (let i = 0; i < diceInfo.diceCount; i++) {
    const roll = rollD(rng, diceInfo.diceSides)
    rolls.push(roll)
    amount += roll
  }
  return { rolls, amount }
}

function changeCreatureInList<T extends Creature>(list: T[], creature: T): T[] {
  return list.map((c) => {
    if (c.id !== creature.id) return c
    return creature
  })
}

function isCharacter(creature: Character | Enemy): creature is Character {
  return Object.hasOwn(creature, "saveRollFails")
}

function isCreatureDead(creature: Character | Enemy): boolean {
  if (isCharacter(creature)) return isPlayerDead(creature)
  return creature.hp === 0
}

function isPlayerDead(player: Character): boolean {
  return player.saveRollFails === 3
}

function getTargetError(target: Character | Enemy): string | null {
  if (isCreatureDead(target)) return `${target.name} is already dead`
  return null
}

function findCreatureById(state: GameState, id: string): Character | Enemy | undefined {
  return state.players.find((p) => p.id === id) ?? state.enemies.find((e) => e.id === id)
}

function areBothSidesInCombat(list: (Character | Enemy)[]): boolean {
  return (
    list.some((c) => isCharacter(c) && !isCreatureDead(c)) &&
    list.some((c) => !isCharacter(c) && !isCreatureDead(c))
  )
}

function getCreaturesInCombat(state: GameState): (Character | Enemy)[] {
  if (!state.combat) return []
  return state.combat.order.map((id) => findCreatureById(state, id)).filter((c) => !!c)
}

// True when one side has nobody left who can fight. Also true when there is no combat at all
// (no creatures in combat), so a single check is enough before passing the turn
function hasCombatEnded(state: GameState): boolean {
  const creatures = getCreaturesInCombat(state)
  return !areBothSidesInCombat(creatures)
}

function passTurn(state: GameState): TurnPassResult {
  if (!state.combat) return { isOk: false, errorText: `No combat is active` }

  const currentActiveCreatureId = state.combat.activeCreatureId
  const currentActiveCreatureIndex = state.combat.order.findIndex(
    (id) => id === currentActiveCreatureId,
  )
  const creatures = getCreaturesInCombat(state)

  if (creatures.length !== state.combat.order.length)
    return { isOk: false, errorText: "Unidentified element in combat" }

  const currentActiveCreature = creatures[currentActiveCreatureIndex]
  if (!currentActiveCreature)
    return { isOk: false, errorText: `No creature found with id ${currentActiveCreatureId}` }

  let nextActiveCreature
  let round = state.combat.round
  let isNewRound = false
  for (let i = 1; i < creatures.length; i++) {
    const currentIndex = (i + currentActiveCreatureIndex) % creatures.length
    const creature = creatures[currentIndex]
    if (!isCreatureDead(creature)) {
      nextActiveCreature = creature
      if (currentIndex < currentActiveCreatureIndex) {
        round++
        isNewRound = true
      }
      break
    }
  }

  if (!nextActiveCreature)
    return {
      isOk: false,
      errorText: "No creatures left in combat.",
    }

  const combat: Combat = {
    ...state.combat,
    round,
    activeCreatureId: nextActiveCreature.id,
  }
  return {
    state: {
      ...state,
      combat,
    },
    nextTurn: {
      nextCreatureId: nextActiveCreature.id,
      nextCreatureName: nextActiveCreature.name,
      round,
      isNewRound,
    },
  }
}

function rollAndApplyDamage(
  state: GameState,
  target: Character | Enemy,
  damage: Dice,
  isCritical: boolean,
  rng: Rng,
): RollAndApplyDamageResult {
  const bonus = damage.bonus
  const diceCountConsideringCrit = isCritical ? damage.diceCount * 2 : damage.diceCount

  const { rolls, amount } = rollDice(
    { diceCount: diceCountConsideringCrit, diceSides: damage.diceSides, bonus },
    rng,
  )

  const hpAfter = Math.max(0, target.hp - amount)
  const event: Omit<DamageEvent, "outcome"> = {
    targetId: target.id,
    targetName: target.name,
    amount,
    rolls,
    bonus,
    hpBefore: target.hp,
    hpAfter,
  }

  if (isCharacter(target)) {
    // logic for player
    let newPlayerState: Character
    let outcome: DamageOutcome
    const isInstantDeath = target.maxHp + target.hp <= amount
    // logic for downed player
    if (target.hp === 0) {
      const saveRollFailsChange = isCritical ? 2 : 1
      const saveRollFails = isInstantDeath
        ? 3
        : Math.min(3, target.saveRollFails + saveRollFailsChange)
      newPlayerState = { ...target, saveRollFails, isStabilizedAfterSave: false }
      outcome = isPlayerDead(newPlayerState) ? "dead" : "down"
    } else {
      if (isInstantDeath) {
        outcome = "dead"
        newPlayerState = { ...target, hp: hpAfter, saveRollFails: 3 }
      } else {
        outcome = hpAfter > 0 ? "alive" : "down"
        newPlayerState = {
          ...target,
          hp: hpAfter,
          saveRollSuccesses: 0,
          saveRollFails: 0,
          isStabilizedAfterSave: false,
        }
      }
    }

    return {
      state: {
        ...state,
        players: changeCreatureInList(state.players, newPlayerState),
      },
      event: { ...event, outcome },
    }
  }

  // target is an enemy here
  return {
    state: {
      ...state,
      enemies: changeCreatureInList(state.enemies, { ...target, hp: hpAfter }),
    },
    event: { ...event, outcome: hpAfter > 0 ? "alive" : "dead" },
  }
}

export function rollCheck(
  state: GameState,
  args: RollCheckArgs,
  rng: Rng = Math.random,
): ReturnResult<"roll_check"> {
  const character = state.players.find((p) => p.id === args.characterId)
  if (!character) return { isOk: false, errorText: `Unknown character: ${args.characterId}` }
  if (character.hp === 0) return { isOk: false, errorText: `Character is down: ${character.name}` }

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
    state,
  }
}

/**
 * Damage without an attack roll: traps, falls, environmental hazards.
 * Always hits, never crits. Dice and bonus come from the model, limited by the args schema.
 */
export function applyDamage(
  state: GameState,
  args: ApplyDamageArgs,
  rng: Rng = Math.random,
): ReturnResult<"apply_damage"> {
  const { targetId, diceCount, diceSides, bonus } = args
  const target = findCreatureById(state, targetId)
  if (!target) return { isOk: false, errorText: `Unknown target: ${targetId}` }

  const targetError = getTargetError(target)
  if (targetError) return { isOk: false, errorText: targetError }

  const result = rollAndApplyDamage(state, target, { diceCount, diceSides, bonus }, false, rng)
  return {
    isOk: true,
    event: result.event,
    state: result.state,
  }
}

export function applyHeal(
  state: GameState,
  args: ApplyHealArgs,
  rng: Rng = Math.random,
): ReturnResult<"apply_heal"> {
  const { targetId, diceCount, diceSides, bonus } = args
  const target = findCreatureById(state, targetId)
  if (!target) return { isOk: false, errorText: `Unknown target: ${targetId}` }

  const targetError = getTargetError(target)
  if (targetError) return { isOk: false, errorText: targetError }

  const { rolls, amount } = rollDice({ diceCount, diceSides, bonus }, rng)
  const hpAfter = Math.min(target.maxHp, target.hp + amount)
  const event: HealEvent = {
    targetId: target.id,
    targetName: target.name,
    amount,
    rolls,
    bonus,
    hpBefore: target.hp,
    hpAfter,
    outcome: target.hp === 0 ? "regainedConsciousness" : "healed",
  }
  if (isCharacter(target)) {
    return {
      isOk: true,
      event,
      state: {
        ...state,
        players: changeCreatureInList(state.players, {
          ...target,
          hp: hpAfter,
          saveRollFails: 0,
          saveRollSuccesses: 0,
          isStabilizedAfterSave: false,
        }),
      },
    }
  }

  // target considered enemy
  return {
    isOk: true,
    event,
    state: {
      ...state,
      enemies: changeCreatureInList(state.enemies, { ...target, hp: hpAfter }),
    },
  }
}

/**
 * Weapon attack: d20 + weapon attack bonus against target AC, then weapon damage on hit.
 * Natural 20 is a critical hit (dice count doubled), natural 1 always misses.
 * The model only picks attacker, weapon and target; all numbers come from the state.
 */
export function attack(
  state: GameState,
  args: AttackArgs,
  rng: Rng = Math.random,
): ReturnResult<"attack"> {
  const attacker = findCreatureById(state, args.attackerId)
  if (!attacker) return { isOk: false, errorText: `Unknown attacker with id: ${args.attackerId}` }
  if (state.combat && attacker.id !== state.combat.activeCreatureId)
    return {
      isOk: false,
      errorText: `Attacker with id ${attacker.id} is not the active one ${state.combat.activeCreatureId}`,
    }

  const target = findCreatureById(state, args.targetId)
  if (!target) return { isOk: false, errorText: `Unknown target with id: ${args.targetId}` }

  const targetError = getTargetError(target)
  if (targetError) return { isOk: false, errorText: targetError }

  const weapon = attacker.weapons.find((w) => w.id === args.weaponId)
  if (!weapon) return { isOk: false, errorText: `Unknown weapon with id: ${args.weaponId}` }
  if (attacker.hp === 0) return { isOk: false, errorText: `Attacker is down: ${attacker.name}` }

  const roll = rollD(rng, 20)
  const total = roll + weapon.attackBonus
  const isCritical = roll === 20
  const hasHit = isCritical || (roll !== 1 && total >= target.armorClass)
  const event: Omit<AttackEvent, "damage" | "nextTurn"> = {
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
  const damageResult = hasHit
    ? rollAndApplyDamage(state, target, weapon.damage, isCritical, rng)
    : null
  const damageEvent = damageResult?.event ?? null
  let nextState = damageResult?.state ?? state
  let nextTurn: TurnPass | null = null

  if (!hasCombatEnded(nextState)) {
    const result = passTurn(nextState)
    if ("isOk" in result) return result
    nextState = result.state
    nextTurn = result.nextTurn
  }

  return {
    isOk: true,
    event: { ...event, damage: damageEvent, nextTurn },
    state: nextState,
  }
}

export function deathSave(
  state: GameState,
  args: DeathSaveArgs,
  rng: Rng = Math.random,
): ReturnResult<"death_save"> {
  const character = state.players.find((p) => p.id === args.characterId)
  if (!character) return { isOk: false, errorText: `Unknown character: ${args.characterId}` }
  if (character.hp > 0) return { isOk: false, errorText: `Character ${character.name} has HP` }
  if (isPlayerDead(character))
    return { isOk: false, errorText: `Character is dead: ${character.name}` }
  if (character.isStabilizedAfterSave)
    return { isOk: false, errorText: `Character ${character.name} is stabilized` }
  if (state.combat && character.id !== state.combat.activeCreatureId)
    return {
      isOk: false,
      errorText: `Player with id ${character.id} is not the active one ${state.combat.activeCreatureId}`,
    }

  const roll = rollD(rng, 20)
  let currentSuccesses = character.saveRollSuccesses
  let currentFailures = character.saveRollFails
  let outcome: DeathOutcomeType
  let isStabilizedAfterSave = false
  let hp = 0

  if (roll === 20) {
    hp = 1
    outcome = "regainedConsciousness"
    currentSuccesses = 0
    currentFailures = 0
  } else if (roll === 1) {
    currentFailures = Math.min(3, currentFailures + 2)
    outcome = "failure"
  } else if (roll >= 10) {
    currentSuccesses += 1
    outcome = "success"
  } else {
    currentFailures += 1
    outcome = "failure"
  }

  if (currentSuccesses === 3) {
    outcome = "stable"
    isStabilizedAfterSave = true
    currentSuccesses = 0
    currentFailures = 0
  }

  if (currentFailures === 3) {
    outcome = "dead"
  }

  const event: DeathSaveEvent = {
    characterId: character.id,
    characterName: character.name,
    roll,
    successes: currentSuccesses,
    failures: currentFailures,
    outcome,
    nextTurn: null,
  }

  const players = changeCreatureInList(state.players, {
    ...character,
    saveRollFails: currentFailures,
    saveRollSuccesses: currentSuccesses,
    isStabilizedAfterSave,
    hp,
  })
  let nextState = { ...state, players }
  let nextTurn: TurnPass | null = null

  // when player rolls 20 he can act
  if (roll !== 20 && !hasCombatEnded(nextState)) {
    const result = passTurn(nextState)
    if ("isOk" in result) return result
    nextTurn = result.nextTurn
    nextState = result.state
  }

  return {
    isOk: true,
    event: { ...event, nextTurn },
    state: nextState,
  }
}

export function startCombat(
  state: GameState,
  args: StartCombatArgs,
  rng: Rng = Math.random,
): ReturnResult<"start_combat"> {
  if (state.combat) return { isOk: false, errorText: "Combat already active" }

  const creatures: (Character | Enemy)[] = []

  for (const participantId of args.participantIds) {
    const participant = findCreatureById(state, participantId)
    if (!participant)
      return { isOk: false, errorText: `Unknown participant with id: ${participantId}` }
    const error = getTargetError(participant)
    if (error) return { isOk: false, errorText: error }
    creatures.push(participant)
  }

  const uniqueParticipants = new Set(creatures)
  if (uniqueParticipants.size !== creatures.length)
    return { isOk: false, errorText: "Duplicate participants" }

  if (!areBothSidesInCombat(creatures))
    return {
      isOk: false,
      errorText: "Combat needs at least one player character and at least one enemy",
    }

  const participants: CombatParticipant[] = creatures.map((c) => {
    const roll = rollD(rng, 20)
    return {
      id: c.id,
      name: c.name,
      side: isCharacter(c) ? "player" : "enemy",
      roll,
      initiativeModifier: c.initiativeModifier,
      total: roll + c.initiativeModifier,
    }
  })

  // On equal totals the order of participantIds is kept.
  participants.sort((a, b) => b.total - a.total)
  const order = participants.map((c) => c.id)

  return {
    isOk: true,
    state: {
      ...state,
      combat: {
        order,
        round: 1,
        activeCreatureId: order[0],
      },
    },
    event: {
      participantsOrder: participants,
    },
  }
}

export function endCombat(state: GameState): ReturnResult<"end_combat"> {
  if (!state.combat) return { isOk: false, errorText: "No combat is active" }
  return {
    isOk: true,
    event: { lastRound: state.combat.round },
    state: {
      ...state,
      combat: null,
    },
  }
}

export function endTurn(state: GameState, args: EndTurnArgs): ReturnResult<"end_turn"> {
  if (!state.combat) return { isOk: false, errorText: `No combat is active` }
  if (hasCombatEnded(state))
    return {
      isOk: false,
      errorText: `One side has no creatures left in combat. Call end_combat to finish the combat`,
    }
  if (args.creatureId !== state.combat.activeCreatureId)
    return {
      isOk: false,
      errorText: `Creature with id: ${args.creatureId} is not current active creature in turn`,
    }
  const currentActiveCreature = findCreatureById(state, args.creatureId)
  if (!currentActiveCreature)
    return { isOk: false, errorText: `Creature with id: ${args.creatureId} is not found` }

  const result = passTurn(state)
  if ("isOk" in result) return result

  return {
    isOk: true,
    event: {
      creatureId: currentActiveCreature.id,
      creatureName: currentActiveCreature.name,
      nextTurn: result.nextTurn,
    },
    state: result.state,
  }
}
