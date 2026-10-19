import type {GameState, RollCheckArgs, ApplyDamageArgs} from "@dnd/shared";

// Генератор случайных чисел [0, 1). В игре Math.random, в тестах подменяем.
export type Rng = () => number;

export function rollD20(rng: Rng = Math.random): number {
  return Math.floor(rng() * 20) + 1;
}

export type CheckResult = {
    ok: true;
    characterId: string;
    skill: string;
    roll: number;
    modifier: number;
    total: number;
    dc: number;
    success: boolean;
  }
  | { ok: false; error: string };

export function rollCheck(state: GameState, args: RollCheckArgs, rng: Rng = Math.random): CheckResult {
  const character = state.players.find((p) => p.id === args.characterId);
  if (!character) return {ok: false, error: `Неизвестный персонаж: ${args.characterId}`};

  // навык, которого нет в листе, считается нетренированным: модификатор 0
  const modifier = character.skills[args.skill] ?? 0;
  const roll = rollD20(rng);
  const total = roll + modifier;
  return {
    ok: true,
    characterId: character.id,
    skill: args.skill,
    roll,
    modifier,
    total,
    dc: args.dc,
    success: total >= args.dc,
  };
}

export type DamageResult = {
    ok: true;
    targetId: string;
    targetName: string;
    amount: number;
    hpBefore: number;
    hpAfter: number;
    defeated: boolean;
    state: GameState; // новое состояние, исходное не меняется
  }
  | { ok: false; error: string };

export function applyDamage(state: GameState, args: ApplyDamageArgs): DamageResult {
  const {targetId, amount} = args;
  const known = state.players.some((p) => p.id === targetId) || state.enemies.some((e) => e.id === targetId);
  if (!known) return {ok: false, error: `Неизвестная цель: ${targetId}`};

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

  const next: GameState = {...state, players: hit(state.players), enemies: hit(state.enemies)};
  return {ok: true, targetId, targetName, amount, hpBefore, hpAfter, defeated: hpAfter === 0, state: next};
}