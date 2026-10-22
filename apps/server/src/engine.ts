import {GameState, RollCheckArgs, ApplyDamageArgs, CheckEvent, DamageEvent, ReturnResult, Tool} from "@dnd/shared";

// Генератор случайных чисел [0, 1). В игре Math.random, в тестах подменяем.
export type Rng = () => number;

export function rollD20(rng: Rng = Math.random): number {
  return Math.floor(rng() * 20) + 1;
}

export function rollCheck(state: GameState, args: RollCheckArgs, rng: Rng = Math.random): ReturnResult<"roll_check"> {
  const character = state.players.find((p) => p.id === args.characterId);
  if (!character) return {isOk: false, errorText: `Неизвестный персонаж: ${args.characterId}`};

  // навык, которого нет в листе, считается нетренированным: модификатор 0
  const modifier = character.skills[args.skill] ?? 0;
  const roll = rollD20(rng);
  const total = roll + modifier;
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

export function applyDamage(state: GameState, args: ApplyDamageArgs): ReturnResult<"apply_damage"> {
  const {targetId, amount} = args;
  const known = state.players.some((p) => p.id === targetId) || state.enemies.some((e) => e.id === targetId);
  if (!known) return {isOk: false, errorText: `Неизвестная цель: ${targetId}`};

  let targetName = "";
  let hpBefore = 0;
  let hpAfter = 0;

  const hit = <T extends { id: string; name: string; hp: number }>(list: T[]): T[] =>
    list.map((t) => {
      if (t.id !== targetId) return t;
      targetName = t.name;
      hpBefore = t.hp;
      hpAfter = Math.max(0, t.hp - amount);
      return {...t, hp: hpAfter};
    });

  const nextState: GameState = {...state, players: hit(state.players), enemies: hit(state.enemies)};
  return {
    isOk: true,
    event: {
      targetId,
      targetName,
      amount,
      hpBefore,
      hpAfter,
      isDefeated: hpAfter === 0
    },
    state: nextState
  }
}