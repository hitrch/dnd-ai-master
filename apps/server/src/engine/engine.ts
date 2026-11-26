import { getItemsIdsFromState } from "@dnd/shared"
import type {
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
  EndCombatEvent,
  ApplyHealingPotionArgs,
  HealOutcome,
  TransferItemsArgs,
  DeleteItemsArgs,
  GiveItemsArgs,
  ItemSummary,
  Item,
  SpawnEnemiesArgs,
  EnemySummary,
  ChangeLocationArgs,
  UpdateWorldBookArgs,
  UpdateBookEventOutcome,
} from "@dnd/shared"

// Random number generator in [0, 1). Math.random in the game, replaced in tests.
export type Rng = () => number
type RollAndApplyDamageResult = {
  state: GameState
  event: DamageEvent
}

type RollAndApplyHealResult = {
  state: GameState
  event: HealEvent
}

type FindItemsAndMoneyToTakeAndUpdateTargetResult = {
  updatedCreature: Character | Enemy
  itemsTaken: Item[]
  itemsNotFoundIds: string[]
  moneyTaken: number
}

type TurnPassResult =
  | {
      state: GameState
      nextTurn: TurnPass | null
      saveEvents: DeathSaveEvent[]
    }
  | EngineError

type SaveRollResult = {
  event: DeathSaveEvent
  newCharacter: Character
}

type NextActiveCreatureInCombatResult = {
  nextActiveCreature: Character | Enemy
  round: number
}

type CloseCombatHelperResult = {
  state: GameState
  combatEnd: EndCombatEvent
}

type EndCombatIfOverResult = {
  state: GameState
  combatEnd: EndCombatEvent | null
}

type RollDiceResult = { rolls: number[]; amount: number }

export function rollD(rng: Rng, sides: number): number {
  return Math.floor(rng() * sides) + 1
}

function rollDice(diceInfo: Dice, rng: Rng): RollDiceResult {
  const rolls: number[] = []
  let amount = diceInfo.bonus
  for (let i = 0; i < diceInfo.diceCount; i++) {
    const roll = rollD(rng, diceInfo.diceSides)
    rolls.push(roll)
    amount += roll
  }
  return { rolls, amount }
}

function transformEnemyToEventFormat(enemies: Enemy[]): EnemySummary[] {
  return enemies.map((e) => ({ id: e.id, name: e.name }))
}

function generateEntityId(prefix: string, extraIdsNotToUse?: Set<string>): string {
  let i = 1
  let newId: string = `${prefix}-${i}`
  while (extraIdsNotToUse?.has(newId)) {
    i++
    newId = `${prefix}-${i}`
  }
  return newId
}

function findItemsAndMoneyToTakeAndUpdateTarget(
  creatureToTakeFrom: Character | Enemy,
  itemsToTransferIds: string[],
  moneyToTake: number,
): FindItemsAndMoneyToTakeAndUpdateTargetResult {
  const targetItemsIdsSet = new Set(creatureToTakeFrom.inventory.map((i) => i.id))
  const itemsTaken: Item[] = creatureToTakeFrom.inventory.filter((item) =>
    itemsToTransferIds.includes(item.id),
  )
  const itemsNotFoundIds = itemsToTransferIds.filter((id) => !targetItemsIdsSet.has(id))
  const moneySubtracted = Math.min(creatureToTakeFrom.money, moneyToTake)
  const itemsToTransferIdSet = new Set(itemsTaken.map((i) => i.id))
  const updatedCreature = {
    ...creatureToTakeFrom,
    money: creatureToTakeFrom.money - moneySubtracted,
    inventory: creatureToTakeFrom.inventory.filter((item) => !itemsToTransferIdSet.has(item.id)),
  }
  return { updatedCreature, itemsTaken, itemsNotFoundIds, moneyTaken: moneySubtracted }
}

function transformItemsToEventFormat(items: Item[]): ItemSummary[] {
  return items.map((i) => ({ id: i.id, name: i.name }))
}

function changeCreatureInState(state: GameState, creature: Character | Enemy): GameState {
  if (isCharacter(creature))
    return { ...state, players: changeCreatureInList(state.players, creature) }
  return { ...state, enemies: changeCreatureInList(state.enemies, creature) }
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

function closeCombatHelper(state: GameState, combat: Combat): CloseCombatHelperResult {
  return { state: { ...state, combat: null }, combatEnd: { lastRound: combat.round } }
}

// Closes the combat when one side has nobody left who can fight; otherwise (or with no combat
// at all) returns the state unchanged with combatEnd: null. The only place where combat ends
// by itself: call it at the end of every tool that can kill in combat (attack, applyDamage, endTurn).
function endCombatIfOver(state: GameState): EndCombatIfOverResult {
  if (!hasCombatEnded(state) || !state.combat) {
    return { state, combatEnd: null }
  }
  return closeCombatHelper(state, state.combat)
}

// True when one side has nobody left who can fight. Also true when there is no combat at all
// (no creatures in combat), so a single check is enough before passing the turn
function hasCombatEnded(state: GameState): boolean {
  const creatures = getCreaturesInCombat(state)
  return !areBothSidesInCombat(creatures)
}

function findNextActiveCreatureInCombat(
  creatures: (Character | Enemy)[],
  initialRound: number,
  currentActiveCreatureIndex: number,
): NextActiveCreatureInCombatResult | EngineError {
  let nextActiveCreature
  let round = initialRound
  for (let i = 1; i < creatures.length; i++) {
    const currentIndex = (i + currentActiveCreatureIndex) % creatures.length
    const creature = creatures[currentIndex]
    if (!isCreatureDead(creature)) {
      nextActiveCreature = creature
      if (currentIndex < currentActiveCreatureIndex) {
        round++
      }
      break
    }
  }

  if (!nextActiveCreature)
    return {
      isOk: false,
      errorText: "No creatures left in combat.",
    }

  return { nextActiveCreature, round }
}

function passTurn(state: GameState, rng: Rng): TurnPassResult {
  if (!state.combat) return { isOk: false, errorText: `No combat is active` }

  const currentActiveCreatureId = state.combat.activeCreatureId
  const currentActiveCreatureIndex = state.combat.order.findIndex(
    (id) => id === currentActiveCreatureId,
  )
  let creatures = getCreaturesInCombat(state)

  if (creatures.length !== state.combat.order.length)
    return { isOk: false, errorText: "Unidentified element in combat" }

  const currentActiveCreature = creatures[currentActiveCreatureIndex]
  if (!currentActiveCreature)
    return { isOk: false, errorText: `No creature found with id ${currentActiveCreatureId}` }

  let nextActiveCreatureResult = findNextActiveCreatureInCombat(
    creatures,
    state.combat.round,
    currentActiveCreatureIndex,
  )
  if ("isOk" in nextActiveCreatureResult) return nextActiveCreatureResult

  let newState: GameState = state
  let combat: Combat = state.combat
  let nextActiveCreature: Character | Enemy = nextActiveCreatureResult.nextActiveCreature
  const initialRound = state.combat.round
  let currentRound = nextActiveCreatureResult.round
  const saveEvents: DeathSaveEvent[] = []

  while (true) {
    nextActiveCreature = nextActiveCreatureResult.nextActiveCreature
    currentRound = nextActiveCreatureResult.round
    combat = { ...combat, round: currentRound, activeCreatureId: nextActiveCreature.id }
    newState = { ...newState, combat }

    // when player downed and not stabilized
    if (isCharacter(nextActiveCreature)) {
      if (nextActiveCreature.hp === 0 && !nextActiveCreature.isStabilizedAfterSave) {
        const { event, newCharacter } = saveRoll(nextActiveCreature, rng)
        saveEvents.push(event)
        newState = {
          ...newState,
          combat,
          players: changeCreatureInList(newState.players, newCharacter),
        }

        // revived and active on crit
        if (event.outcome === "regainedConsciousness") break
      }
    }

    creatures = getCreaturesInCombat(newState)
    if (!areBothSidesInCombat(creatures)) {
      break
    }
    if (nextActiveCreature.hp > 0) break

    const newActiveCreatureIndex = combat.order.findIndex((id) => id === nextActiveCreature.id)
    nextActiveCreatureResult = findNextActiveCreatureInCombat(
      creatures,
      combat.round,
      newActiveCreatureIndex,
    )
    if ("isOk" in nextActiveCreatureResult) return nextActiveCreatureResult
  }

  let nextTurn: TurnPass | null = null
  if (!hasCombatEnded(newState)) {
    nextTurn = {
      nextCreatureId: nextActiveCreature.id,
      nextCreatureName: nextActiveCreature.name,
      round: currentRound,
      isNewRound: initialRound !== currentRound,
    }
  }

  return {
    state: newState,
    nextTurn,
    saveEvents,
  }
}

function saveRoll(character: Character, rng: Rng): SaveRollResult {
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
  }

  return {
    event,
    newCharacter: {
      ...character,
      saveRollFails: currentFailures,
      saveRollSuccesses: currentSuccesses,
      isStabilizedAfterSave,
      hp,
    },
  }
}

function rollAndApplyHeal(
  state: GameState,
  target: Character | Enemy,
  heal: Dice,
  rng: Rng,
): RollAndApplyHealResult {
  const { rolls, amount } = rollDice(heal, rng)
  const hpAfter = Math.min(target.maxHp, target.hp + amount)
  let nextState = state
  const event: Omit<HealEvent, "outcome"> = {
    targetId: target.id,
    targetName: target.name,
    amount,
    rolls,
    bonus: heal.bonus,
    hpBefore: target.hp,
    hpAfter,
  }
  let outcome: HealOutcome

  if (isCharacter(target)) {
    outcome = target.hp === 0 ? "regainedConsciousness" : "healed"
    nextState = changeCreatureInState(nextState, {
      ...target,
      hp: hpAfter,
      saveRollFails: 0,
      saveRollSuccesses: 0,
      isStabilizedAfterSave: false,
    })
  } else {
    nextState = changeCreatureInState(nextState, { ...target, hp: hpAfter })
    outcome = "healed"
  }
  return {
    state: nextState,
    event: { ...event, outcome },
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
      state: changeCreatureInState(state, newPlayerState),
      event: { ...event, outcome },
    }
  }

  // target is an enemy here
  return {
    state: changeCreatureInState(state, { ...target, hp: hpAfter }),
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
  const combatState = endCombatIfOver(result.state)
  return {
    isOk: true,
    event: {
      damage: result.event,
      combatEnd: combatState.combatEnd,
    },
    state: combatState.state,
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

  const result = rollAndApplyHeal(state, target, { diceCount, diceSides, bonus }, rng)
  return {
    isOk: true,
    event: result.event,
    state: result.state,
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

  const weapon = attacker.inventory.find((i) => i.id === args.weaponId)
  if (!weapon) return { isOk: false, errorText: `Unknown weapon with id: ${args.weaponId}` }
  if (weapon.kind !== "weapon")
    return { isOk: false, errorText: `Item with id: ${args.weaponId} is not a weapon` }
  if (attacker.hp === 0) return { isOk: false, errorText: `Attacker is down: ${attacker.name}` }

  const roll = rollD(rng, 20)
  const total = roll + weapon.attackBonus
  const isCritical = roll === 20
  const hasHit = isCritical || (roll !== 1 && total >= target.armorClass)
  const event: Omit<AttackEvent, "damage" | "nextTurn" | "combatEnd" | "saveEvents"> = {
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
  let saveEvents: DeathSaveEvent[] = []

  if (!hasCombatEnded(nextState)) {
    const result = passTurn(nextState, rng)
    if ("isOk" in result) return result
    nextState = result.state
    nextTurn = result.nextTurn
    saveEvents = result.saveEvents
  }

  const combatState = endCombatIfOver(nextState)
  const combatEnd = combatState.combatEnd
  return {
    isOk: true,
    event: {
      ...event,
      damage: damageEvent,
      nextTurn,
      combatEnd,
      saveEvents,
    },
    state: combatState.state,
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
  if (state.combat)
    return {
      isOk: false,
      errorText:
        "death_save is not used in combat: death saves are rolled automatically when the turn passes to a dying character",
    }

  const { event, newCharacter } = saveRoll(character, rng)
  const players = changeCreatureInList(state.players, newCharacter)

  return {
    isOk: true,
    event: event,
    state: { ...state, players },
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
  const result = closeCombatHelper(state, state.combat)
  return {
    isOk: true,
    event: result.combatEnd,
    state: result.state,
  }
}

export function endTurn(
  state: GameState,
  args: EndTurnArgs,
  rng: Rng = Math.random,
): ReturnResult<"end_turn"> {
  if (!state.combat) return { isOk: false, errorText: `No combat is active` }
  if (args.creatureId !== state.combat.activeCreatureId)
    return {
      isOk: false,
      errorText: `Creature with id: ${args.creatureId} is not current active creature in turn`,
    }
  const currentActiveCreature = findCreatureById(state, args.creatureId)
  if (!currentActiveCreature)
    return { isOk: false, errorText: `Creature with id: ${args.creatureId} is not found` }

  const result = passTurn(state, rng)
  if ("isOk" in result) return result

  const combatState = endCombatIfOver(result.state)
  return {
    isOk: true,
    event: {
      creatureId: currentActiveCreature.id,
      creatureName: currentActiveCreature.name,
      nextTurn: result.nextTurn,
      combatEnd: combatState.combatEnd,
      saveEvents: result.saveEvents,
    },
    state: combatState.state,
  }
}

export function applyHealingPotion(
  state: GameState,
  args: ApplyHealingPotionArgs,
  rng: Rng,
): ReturnResult<"apply_healing_potion"> {
  const user = findCreatureById(state, args.userId)
  if (!user) return { isOk: false, errorText: `Potion user with id: ${args.userId} is not found` }
  if (user.hp === 0) return { isOk: false, errorText: `Potion user is down: ${user.name}` }
  if (state.combat && user.id !== state.combat.activeCreatureId)
    return {
      isOk: false,
      errorText: `Potion user with id ${user.id} is not current active creature`,
    }

  const target = findCreatureById(state, args.targetId)
  if (!target)
    return { isOk: false, errorText: `Potion target with id: ${args.targetId} is not found` }

  const targetError = getTargetError(target)
  if (targetError) return { isOk: false, errorText: targetError }
  const potion = user.inventory.find((i) => i.id === args.potionId)
  if (!potion) return { isOk: false, errorText: `Potion with id: ${args.potionId} is not found` }
  if (potion.kind !== "healing_potion")
    return { isOk: false, errorText: `Item with id: ${potion.id} is not a potion` }

  const healingResult = rollAndApplyHeal(state, target, potion.healing, rng)
  const userAfterHeal = findCreatureById(healingResult.state, args.userId)
  if (!userAfterHeal)
    throw new Error(`Potion user with id ${args.userId} disappeared after healing`)

  const inventoryAfterPotionUsage = userAfterHeal.inventory.filter((item) => item.id !== potion.id)
  const nextState = changeCreatureInState(healingResult.state, {
    ...userAfterHeal,
    inventory: inventoryAfterPotionUsage,
  })

  return {
    isOk: true,
    event: {
      ...healingResult.event,
      userId: user.id,
      userName: user.name,
      potionId: potion.id,
      potionName: potion.name,
    },
    state: nextState,
  }
}

export function transferItems(
  state: GameState,
  args: TransferItemsArgs,
): ReturnResult<"transfer_items"> {
  const giver = findCreatureById(state, args.sourceId)
  if (!giver) return { isOk: false, errorText: `No giver with id ${args.sourceId} found` }

  const receiver = findCreatureById(state, args.targetId)
  if (!receiver) return { isOk: false, errorText: `No receiver with id ${args.targetId} found` }
  if (giver.id === receiver.id) return { isOk: false, errorText: `Transferring to self` }

  const error = getTargetError(receiver)
  if (error) return { isOk: false, errorText: error }
  if (state.combat && giver.id !== state.combat.activeCreatureId)
    return {
      isOk: false,
      errorText: `Creature with id ${giver.id} is not the one active in combat now`,
    }

  const { updatedCreature, itemsTaken, itemsNotFoundIds, moneyTaken } =
    findItemsAndMoneyToTakeAndUpdateTarget(giver, args.itemIds, args.moneyToTransfer)
  if (!moneyTaken && itemsTaken.length === 0)
    return {
      isOk: false,
      errorText: `No items or money to transfer`,
    }

  const stateAfterReceiverUpdated = changeCreatureInState(state, {
    ...receiver,
    money: receiver.money + moneyTaken,
    inventory: [...receiver.inventory, ...itemsTaken],
  })
  const resultState = changeCreatureInState(stateAfterReceiverUpdated, updatedCreature)
  return {
    isOk: true,
    event: {
      sourceId: giver.id,
      sourceName: giver.name,
      targetId: receiver.id,
      targetName: receiver.name,
      itemsTransferred: transformItemsToEventFormat(itemsTaken),
      moneyTransferred: moneyTaken,
      notFoundIds: itemsNotFoundIds,
    },
    state: resultState,
  }
}

export function deleteItems(state: GameState, args: DeleteItemsArgs): ReturnResult<"delete_items"> {
  const target = findCreatureById(state, args.targetId)
  if (!target)
    return { isOk: false, errorText: `No target for expropriation with id ${args.targetId} found` }

  const { updatedCreature, itemsTaken, itemsNotFoundIds, moneyTaken } =
    findItemsAndMoneyToTakeAndUpdateTarget(target, args.itemIds, args.moneyToTake)
  if (!moneyTaken && itemsTaken.length === 0)
    return {
      isOk: false,
      errorText: `No items or money to delete`,
    }

  const nextState = changeCreatureInState(state, updatedCreature)
  return {
    isOk: true,
    event: {
      targetId: updatedCreature.id,
      targetName: updatedCreature.name,
      deletedItems: transformItemsToEventFormat(itemsTaken),
      notFoundIds: itemsNotFoundIds,
      moneyTaken: moneyTaken,
    },
    state: nextState,
  }
}

export function giveItems(state: GameState, args: GiveItemsArgs): ReturnResult<"give_items"> {
  const target = findCreatureById(state, args.targetId)
  if (!target)
    return {
      isOk: false,
      errorText: `No target for enriching with items with id ${args.targetId} found`,
    }
  const targetError = getTargetError(target)
  if (targetError) return { isOk: false, errorText: targetError }
  if (!args.moneyToGive && args.items.length === 0)
    return { isOk: false, errorText: `No items or money to give` }

  const itemsGiven: Item[] = []
  const takenItemsIdsInState = getItemsIdsFromState(state)

  for (let i = 0; i < args.items.length; i++) {
    const newId = generateEntityId(
      "item",
      new Set([...takenItemsIdsInState, ...itemsGiven.map((item) => item.id)]),
    )
    itemsGiven.push({ ...args.items[i], id: newId })
  }

  const nextState = changeCreatureInState(state, {
    ...target,
    money: target.money + args.moneyToGive,
    inventory: [...target.inventory, ...itemsGiven],
  })
  return {
    isOk: true,
    event: {
      targetId: target.id,
      targetName: target.name,
      itemsGiven: transformItemsToEventFormat(itemsGiven),
      moneyGiven: args.moneyToGive,
    },
    state: nextState,
  }
}

export function spawnEnemies(
  state: GameState,
  args: SpawnEnemiesArgs,
): ReturnResult<"spawn_enemies"> {
  if (args.enemies.length === 0) return { isOk: false, errorText: "No enemies to spawn" }

  const newEnemies: Enemy[] = []
  const newTakenItemIds: string[] = []
  const itemIdsFromState: string[] = getItemsIdsFromState(state)
  const takenCreaturesIdsInState: string[] = [
    ...state.enemies.map((e) => e.id),
    ...state.players.map((p) => p.id),
  ]

  for (let i = 0; i < args.enemies.length; i++) {
    const takenIds = new Set([...newEnemies.map((e) => e.id), ...takenCreaturesIdsInState])
    const newEnemyId = generateEntityId("enemy", takenIds)
    const inventoryWithIds = args.enemies[i].inventory.map((item) => {
      const newItemId = generateEntityId("item", new Set([...newTakenItemIds, ...itemIdsFromState]))
      newTakenItemIds.push(newItemId)
      return { ...item, id: newItemId }
    })
    newEnemies.push({
      ...args.enemies[i],
      id: newEnemyId,
      hp: args.enemies[i].maxHp,
      inventory: inventoryWithIds,
    })
  }

  const combat: Combat | null = state.combat
    ? { ...state.combat, order: [...state.combat.order, ...newEnemies.map((e) => e.id)] }
    : null
  const newState: GameState = { ...state, combat, enemies: [...state.enemies, ...newEnemies] }
  return {
    isOk: true,
    event: {
      enemies: transformEnemyToEventFormat(newEnemies),
      hasEnteredCombat: !!newState.combat,
    },
    state: newState,
  }
}

export function changeLocation(
  state: GameState,
  args: ChangeLocationArgs,
): ReturnResult<"change_location"> {
  if (state.combat)
    return {
      isOk: false,
      errorText:
        '"Cannot change location during combat: end the combat first (end_combat if the characters escape or the enemies flee).',
    }

  return {
    isOk: true,
    event: {
      previousLocationName: state.location.name,
      newLocationName: args.name,
      enemiesOfPreviousLocation: transformEnemyToEventFormat(state.enemies),
    },
    state: {
      ...state,
      location: args,
      enemies: [],
    },
  }
}

export function updateWorldBook(
  state: GameState,
  args: UpdateWorldBookArgs,
): ReturnResult<"update_world_book"> {
  const { id, text } = args
  if (!id && !text)
    return { isOk: false, errorText: "Both id and text are missing when updating world book" }

  if (id) {
    const noteToBeUpdated = state.worldBook.find((note) => note.id === id)
    if (!noteToBeUpdated) return { isOk: false, errorText: `Note with id ${id} not found` }
    if (text) {
      return {
        isOk: true,
        event: {
          id,
          outcome: "updated",
        },
        state: {
          ...state,
          worldBook: state.worldBook.map((note) => (note.id === id ? { ...note, text } : note)),
        },
      }
    }
    return {
      isOk: true,
      event: {
        id: id,
        outcome: "deleted",
      },
      state: { ...state, worldBook: state.worldBook.filter((note) => note.id !== id) },
    }
  } else {
    if (text) {
      const worldBookMaxLength = 20
      if (state.worldBook.length >= worldBookMaxLength)
        return {
          isOk: false,
          errorText:
            `The world book is full (${worldBookMaxLength} notes): delete a note that no longer matters ` +
            "(its id without text) or rewrite an existing note to hold this fact, then try again.",
        }

      const noteIdsInUse = new Set(state.worldBook.map((note) => note.id))
      const newId = generateEntityId("note", noteIdsInUse)
      return {
        isOk: true,
        event: {
          id: newId,
          outcome: "created",
        },
        state: { ...state, worldBook: [...state.worldBook, { id: newId, text: text }] },
      }
    }
  }

  throw new Error(
    "Unreachable in updateWorldBook: args without id and text are refused at the start",
  )
}
