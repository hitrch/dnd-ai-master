import type {
  GameState,
  RollCheckArgs,
  ApplyDamageArgs,
  ReturnResult,
} from "@dnd/shared";

// Random number generator in [0, 1). Math.random in the game, replaced in tests.
export type Rng = () => number

export function rollD(rng: Rng = Math.random, sides: number): number {
  return Math.floor(rng() * sides) + 1
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
  const known = state.players.some((p) => p.id === targetId) || state.enemies.some((e) => e.id === targetId)
  if (!known) return {isOk: false, errorText: `Unknown target: ${targetId}`}

  let targetName = ""
  let hpBefore = 0
  let hpAfter = 0
  let amount = bonus
  const rolls: number[] = []

  for(let i = 0; i < diceCount; i++) {
    const roll = rollD(rng, diceSides)
    rolls.push(roll)
    amount += roll
  }

  const hit = <T extends { id: string; name: string; hp: number }>(list: T[]): T[] =>
    list.map((t) => {
      if (t.id !== targetId) return t
      targetName = t.name
      hpBefore = t.hp
      hpAfter = Math.max(0, t.hp - amount)
      return {...t, hp: hpAfter}
    })

  const nextState: GameState = {...state, players: hit(state.players), enemies: hit(state.enemies)};
  return {
    isOk: true,
    event: {
      targetId,
      targetName,
      amount,
      rolls,
      bonus,
      hpBefore,
      hpAfter,
      isDefeated: hpAfter === 0,
    },
    state: nextState
  }
}
