import {
  ApplyDamageArgs,
  ApplyHealArgs,
  AttackArgs,
  DeathSaveArgs,
  EndCombatArgs,
  EndTurnArgs,
  RollCheckArgs,
  StartCombatArgs,
} from "./tools"
import type { Skill } from "./skills"
import type { GameState } from "./state"

export type ToolMap = {
  roll_check: {
    event: CheckEvent
    args: RollCheckArgs
  }
  apply_damage: {
    event: DamageEvent
    args: ApplyDamageArgs
  }
  attack: {
    event: AttackEvent
    args: AttackArgs
  }
  death_save: {
    event: DeathSaveEvent
    args: DeathSaveArgs
  }
  apply_heal: {
    event: HealEvent
    args: ApplyHealArgs
  }
  start_combat: {
    event: StartCombatEvent
    args: StartCombatArgs
  }
  end_combat: {
    event: EndCombatEvent
    args: EndCombatArgs
  }
  end_turn: {
    event: EndTurnEvent
    args: EndTurnArgs
  }
}
export type ToolName = keyof ToolMap

export type TurnPass = {
  nextCreatureId: string
  nextCreatureName: string
  round: number
  isNewRound: boolean
}

export type EndTurnEvent = {
  creatureId: string
  creatureName: string
  nextTurn: TurnPass
}

export type EndCombatEvent = {
  lastRound: number
}

export type Side = "player" | "enemy"

export interface CombatParticipant {
  id: string
  name: string
  side: Side
  roll: number
  initiativeModifier: number
  total: number
}

export type StartCombatEvent = {
  participantsOrder: CombatParticipant[]
}

export type DeathOutcomeType = "success" | "failure" | "stable" | "dead" | "regainedConsciousness"

export type DeathSaveEvent = {
  characterId: string
  characterName: string
  roll: number
  successes: number
  failures: number
  outcome: DeathOutcomeType
  nextTurn: TurnPass | null
}

export type CheckEvent = {
  characterId: string
  characterName: string
  skill: Skill
  roll: number
  modifier: number
  total: number
  dc: number
  success: boolean
}

export type DamageOutcome = "dead" | "down" | "alive"

export type DamageEvent = {
  targetId: string
  targetName: string
  amount: number
  rolls: number[]
  bonus: number
  hpBefore: number
  hpAfter: number
  outcome: DamageOutcome
}

export type HealOutcome = "healed" | "regainedConsciousness"

export type HealEvent = {
  targetId: string
  targetName: string
  amount: number
  rolls: number[]
  bonus: number
  hpBefore: number
  hpAfter: number
  outcome: HealOutcome
}

export type AttackEvent = {
  attackerId: string
  attackerName: string
  targetId: string
  targetName: string
  weaponId: string
  weaponName: string
  targetArmorClass: number
  roll: number
  attackBonus: number
  total: number
  hasHit: boolean
  isCritical: boolean
  damage: DamageEvent | null
  nextTurn: TurnPass | null
}

export type GameRecord = {
  [K in keyof ToolMap]: {
    tool: K
    args: ToolMap[K]["args"]
    event: ToolMap[K]["event"]
  }
}[keyof ToolMap]

export type EngineError = {
  isOk: false
  errorText: string
}

export type ReturnResult<T extends ToolName> =
  | EngineError
  | {
      isOk: true
      event: ToolMap[T]["event"]
      state: GameState
    }
