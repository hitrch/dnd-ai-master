import type {ActionStore, ModelProvider, StoryMessage, ToolCall, ToolRunResult} from "../types"
import {applyDamage, rollCheck} from "../engine/engine"
import type {Rng} from "../engine/engine"
import {ToolArgsSchemas} from "@dnd/shared"
import type {GameState, GameRecord} from "@dnd/shared"
import {isTool} from "../utils";
import {toolDefinitions} from "./toolDefinitions";
import {modelDefinition} from "./modelDefinition";


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
  private readonly _messages: StoryMessage[] = []
  private readonly _model: ModelProvider
  private readonly _rng: Rng
  private readonly _maxRounds = 5

  constructor(store: ActionStore, roomId: string, model: ModelProvider, rng: Rng = Math.random) {
    this._store = store
    this._roomId = roomId
    this._model = model
    this._rng = rng
  }

  async handleMessage(text: string): Promise<string> {
    let draft = await this._store.startAction(this._roomId)
    try {
      const messages: StoryMessage[] = [{messageType: "player_text", text}]

      for (let i = 0; i < this._maxRounds; i++) {
        const instructions = modelDefinition.modelInstruction + "\n" + JSON.stringify(draft)
        const modelResponse = await this._model.generate([...this._messages, ...messages], toolDefinitions, instructions)
        messages.push(modelResponse)
        switch (modelResponse.messageType) {
          case "model_text": {
            await this._store.commitAction(this._roomId, draft)
            this._messages.push(...messages)
            return modelResponse.text
          }
          case "tool_calls": {
            const executionResult = executeTools(modelResponse.calls, draft, this._rng)
            draft = executionResult.state
            messages.push({messageType: "tool_results", records: executionResult.records})
            break
          }
          default: {
            const unreachable: never = modelResponse
            throw new Error(`Invalid model response: ${JSON.stringify(unreachable)}`)
          }
        }
      }
      throw new Error(`Max round reached ${this._maxRounds}`)
    } catch (e) {
      await this._store.cancelAction(this._roomId)
      throw e
    }
  }
}
