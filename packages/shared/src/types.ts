import type {ApplyDamageArgs, RollCheckArgs} from "./tools";
import type {Skill} from "./skills";
import type {GameState} from "./state";


export type ToolMap = {
  roll_check: {
    event: CheckEvent,
    args: RollCheckArgs
  },
  apply_damage: {
    event: DamageEvent,
    args: ApplyDamageArgs
  },
}
export type Tool = keyof ToolMap

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

export type DamageEvent = {
  targetId: string
  targetName: string
  amount: number    //model is responsible for it not the engine
  hpBefore: number
  hpAfter: number
  isDefeated: boolean
}

export type GameRecord = {
  [K in keyof ToolMap]: {
    tool: K
    args: ToolMap[K]["args"]
    event: ToolMap[K]["event"]
  }
} [keyof ToolMap]

export type ReturnResult<T extends Tool> =
  | {
  isOk: false
  errorText: string
}
  | {
  isOk: true
  event: ToolMap[T]["event"]
  state: GameState
}