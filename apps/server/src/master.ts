import type {Content} from "@google/genai"
import type {ActionStore, ToolCall, ToolRunResult} from "./types"
import {applyDamage, Rng, rollCheck} from "./engine"
import {GameRecord, GameState, isTool, ToolArgsSchemas} from "@dnd/shared"


export function executeTools(tools: ToolCall[], gameState: GameState, rng: Rng): ToolRunResult {
  const gameRecords: GameRecord[] = []
  let draft = gameState
  for(const call of tools) {
    if(!isTool(call.name)) throw new Error(`Unknown tool: ${call.name}`)
    switch (call.name) {
      case "roll_check": {
        const rollCheckArgs = ToolArgsSchemas.roll_check.parse(call.args)
        const rollCheckResult = rollCheck(draft, rollCheckArgs, rng)
        if(!rollCheckResult.isOk) throw new Error(rollCheckResult.errorText)
        draft = rollCheckResult.state
        gameRecords.push({tool: "roll_check", args: rollCheckArgs, event: rollCheckResult.event})
        break
      }
      case "apply_damage": {
        const applyDamageArgs = ToolArgsSchemas.apply_damage.parse(call.args)
        const applyDamageResult = applyDamage(draft, applyDamageArgs)
        if(!applyDamageResult.isOk) throw new Error(applyDamageResult.errorText)
        draft = applyDamageResult.state
        gameRecords.push({tool: "apply_damage", args: applyDamageArgs, event: applyDamageResult.event})
        break
      }
      default: {
        const unreachable: never = call.name
        throw new Error(`Unhandled tool: ${unreachable}`)
      }
    }
  }

  return {state: draft, records: gameRecords }
}

export class Master {
  private readonly _roomId: string
  private readonly _store: ActionStore
  private readonly _messages: Content[] = []

  constructor(store: ActionStore, roomId: string) {
    this._store = store
    this._roomId = roomId
  }

  async handleMessage(text: string) {
    const temporalGameState = await this._store.startAction(this._roomId)
    try {



      await this._store.commitAction(this._roomId, temporalGameState)
    } catch (e) {
      await this._store.cancelAction(this._roomId)
      throw e
    }
  }
}
