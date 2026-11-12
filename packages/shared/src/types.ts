import type {
  ApplyDamageArgs,
  ApplyHealArgs,
  AttackArgs,
  DeathSaveArgs,
  RollCheckArgs,
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
}
export type ToolName = keyof ToolMap

export type DeathOutcomeType = "success" | "failure" | "stable" | "dead" | "revived"

export type DeathSaveEvent = {
  characterId: string
  characterName: string
  roll: number
  successes: number
  failures: number
  outcome: DeathOutcomeType
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
}

export type GameRecord = {
  [K in keyof ToolMap]: {
    tool: K
    args: ToolMap[K]["args"]
    event: ToolMap[K]["event"]
  }
}[keyof ToolMap]

export type ReturnResult<T extends ToolName> =
  | {
      isOk: false
      errorText: string
    }
  | {
      isOk: true
      event: ToolMap[T]["event"]
      state: GameState
    }
