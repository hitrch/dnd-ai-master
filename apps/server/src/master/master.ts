import type { ModelProvider, StoryMessage, ToolCall } from "../model/types"
import {
  applyDamage,
  applyHeal,
  applyHealingPotion,
  attack,
  changeLocation,
  deathSave,
  deleteItems,
  endCombat,
  endTurn,
  giveItems,
  rollCheck,
  spawnEnemies,
  startCombat,
  transferItems,
} from "../engine/engine"
import type { Rng } from "../engine/engine"
import { ToolArgsSchemas } from "@dnd/shared"
import type { GameState } from "@dnd/shared"
import { isTool } from "../utils"
import { toolDefinitions } from "./toolDefinitions"
import { modelDefinition } from "./modelDefinition"
import type { ActionStore, ToolResult, ToolRunResult } from "../types"
import { z } from "zod"

export type SplitHistoryForSummaryResult = {
  messagesToSummarize: StoryMessage[]
  messagesToKeep: StoryMessage[]
}

export function executeTools(tools: ToolCall[], gameState: GameState, rng: Rng): ToolRunResult {
  const results: ToolResult[] = []
  let draft = gameState
  let hasFailed = false
  const fail = (tool: string, errorText: string) => {
    results.push({ isOk: false, tool, errorText })
    hasFailed = true
  }

  for (const call of tools) {
    if (hasFailed) {
      results.push({ isOk: false, tool: call.name, errorText: "skipped: previous call failed" })
      continue
    }

    if (!isTool(call.name)) {
      fail(call.name, `Unknown tool: ${call.name}`)
      continue
    }

    switch (call.name) {
      case "roll_check": {
        const rollCheckArgs = ToolArgsSchemas.roll_check.safeParse(call.args)
        if (!rollCheckArgs.success) {
          fail(call.name, z.prettifyError(rollCheckArgs.error))
          continue
        }

        const rollCheckResult = rollCheck(draft, rollCheckArgs.data, rng)
        if (!rollCheckResult.isOk) {
          fail(call.name, rollCheckResult.errorText)
          continue
        }

        draft = rollCheckResult.state
        results.push({
          isOk: true,
          tool: "roll_check",
          args: rollCheckArgs.data,
          event: rollCheckResult.event,
        })
        break
      }
      case "apply_damage": {
        const applyDamageArgs = ToolArgsSchemas.apply_damage.safeParse(call.args)
        if (!applyDamageArgs.success) {
          fail(call.name, z.prettifyError(applyDamageArgs.error))
          continue
        }

        const applyDamageResult = applyDamage(draft, applyDamageArgs.data, rng)
        if (!applyDamageResult.isOk) {
          fail(call.name, applyDamageResult.errorText)
          continue
        }

        draft = applyDamageResult.state
        results.push({
          isOk: true,
          tool: "apply_damage",
          args: applyDamageArgs.data,
          event: applyDamageResult.event,
        })
        break
      }
      case "attack": {
        const attackArgs = ToolArgsSchemas.attack.safeParse(call.args)
        if (!attackArgs.success) {
          fail(call.name, z.prettifyError(attackArgs.error))
          continue
        }

        const attackResult = attack(draft, attackArgs.data, rng)
        if (!attackResult.isOk) {
          fail(call.name, attackResult.errorText)
          continue
        }

        draft = attackResult.state
        results.push({
          isOk: true,
          tool: "attack",
          args: attackArgs.data,
          event: attackResult.event,
        })
        break
      }
      case "death_save": {
        const deathSaveArgs = ToolArgsSchemas.death_save.safeParse(call.args)
        if (!deathSaveArgs.success) {
          fail(call.name, z.prettifyError(deathSaveArgs.error))
          continue
        }

        const deathSaveResult = deathSave(draft, deathSaveArgs.data, rng)
        if (!deathSaveResult.isOk) {
          fail(call.name, deathSaveResult.errorText)
          continue
        }

        draft = deathSaveResult.state
        results.push({
          isOk: true,
          tool: "death_save",
          args: deathSaveArgs.data,
          event: deathSaveResult.event,
        })
        break
      }
      case "apply_heal": {
        const applyHealArgs = ToolArgsSchemas.apply_heal.safeParse(call.args)
        if (!applyHealArgs.success) {
          fail(call.name, z.prettifyError(applyHealArgs.error))
          continue
        }

        const applyHealResult = applyHeal(draft, applyHealArgs.data, rng)
        if (!applyHealResult.isOk) {
          fail(call.name, applyHealResult.errorText)
          continue
        }

        draft = applyHealResult.state
        results.push({
          isOk: true,
          tool: "apply_heal",
          args: applyHealArgs.data,
          event: applyHealResult.event,
        })
        break
      }
      case "start_combat": {
        const startCombatArgs = ToolArgsSchemas.start_combat.safeParse(call.args)
        if (!startCombatArgs.success) {
          fail(call.name, z.prettifyError(startCombatArgs.error))
          continue
        }

        const startCombatResult = startCombat(draft, startCombatArgs.data, rng)
        if (!startCombatResult.isOk) {
          fail(call.name, startCombatResult.errorText)
          continue
        }

        draft = startCombatResult.state
        results.push({
          isOk: true,
          tool: "start_combat",
          args: startCombatArgs.data,
          event: startCombatResult.event,
        })
        break
      }
      case "end_combat": {
        const endCombatArgs = ToolArgsSchemas.end_combat.safeParse(call.args)
        if (!endCombatArgs.success) {
          fail(call.name, z.prettifyError(endCombatArgs.error))
          continue
        }

        const endCombatResult = endCombat(draft)
        if (!endCombatResult.isOk) {
          fail(call.name, endCombatResult.errorText)
          continue
        }

        draft = endCombatResult.state
        results.push({
          isOk: true,
          tool: "end_combat",
          args: endCombatArgs.data,
          event: endCombatResult.event,
        })
        break
      }
      case "end_turn": {
        const endTurnArgs = ToolArgsSchemas.end_turn.safeParse(call.args)
        if (!endTurnArgs.success) {
          fail(call.name, z.prettifyError(endTurnArgs.error))
          continue
        }

        const endTurnResult = endTurn(draft, endTurnArgs.data, rng)
        if (!endTurnResult.isOk) {
          fail(call.name, endTurnResult.errorText)
          continue
        }
        draft = endTurnResult.state
        results.push({
          isOk: true,
          tool: "end_turn",
          args: endTurnArgs.data,
          event: endTurnResult.event,
        })
        break
      }
      case "apply_healing_potion": {
        const applyHealingPotionArgs = ToolArgsSchemas.apply_healing_potion.safeParse(call.args)
        if (!applyHealingPotionArgs.success) {
          fail(call.name, z.prettifyError(applyHealingPotionArgs.error))
          continue
        }

        const applyHealingPotionResult = applyHealingPotion(draft, applyHealingPotionArgs.data, rng)
        if (!applyHealingPotionResult.isOk) {
          fail(call.name, applyHealingPotionResult.errorText)
          continue
        }

        draft = applyHealingPotionResult.state
        results.push({
          isOk: true,
          tool: "apply_healing_potion",
          args: applyHealingPotionArgs.data,
          event: applyHealingPotionResult.event,
        })
        break
      }
      case "transfer_items": {
        const transferItemsArgs = ToolArgsSchemas.transfer_items.safeParse(call.args)
        if (!transferItemsArgs.success) {
          fail(call.name, z.prettifyError(transferItemsArgs.error))
          continue
        }

        const transferItemsResult = transferItems(draft, transferItemsArgs.data)
        if (!transferItemsResult.isOk) {
          fail(call.name, transferItemsResult.errorText)
          continue
        }

        draft = transferItemsResult.state
        results.push({
          isOk: true,
          tool: "transfer_items",
          args: transferItemsArgs.data,
          event: transferItemsResult.event,
        })
        break
      }
      case "delete_items": {
        const deleteItemsArgs = ToolArgsSchemas.delete_items.safeParse(call.args)
        if (!deleteItemsArgs.success) {
          fail(call.name, z.prettifyError(deleteItemsArgs.error))
          continue
        }

        const deleteItemsResult = deleteItems(draft, deleteItemsArgs.data)
        if (!deleteItemsResult.isOk) {
          fail(call.name, deleteItemsResult.errorText)
          continue
        }

        draft = deleteItemsResult.state
        results.push({
          isOk: true,
          tool: "delete_items",
          args: deleteItemsArgs.data,
          event: deleteItemsResult.event,
        })
        break
      }
      case "give_items": {
        const giveItemsArgs = ToolArgsSchemas.give_items.safeParse(call.args)
        if (!giveItemsArgs.success) {
          fail(call.name, z.prettifyError(giveItemsArgs.error))
          continue
        }

        const giveItemsResult = giveItems(draft, giveItemsArgs.data)
        if (!giveItemsResult.isOk) {
          fail(call.name, giveItemsResult.errorText)
          continue
        }

        draft = giveItemsResult.state
        results.push({
          isOk: true,
          tool: "give_items",
          args: giveItemsArgs.data,
          event: giveItemsResult.event,
        })
        break
      }
      case "spawn_enemies": {
        const spawnEnemiesArgs = ToolArgsSchemas.spawn_enemies.safeParse(call.args)
        if (!spawnEnemiesArgs.success) {
          fail(call.name, z.prettifyError(spawnEnemiesArgs.error))
          continue
        }

        const spawnEnemyResult = spawnEnemies(draft, spawnEnemiesArgs.data)
        if (!spawnEnemyResult.isOk) {
          fail(call.name, spawnEnemyResult.errorText)
          continue
        }

        draft = spawnEnemyResult.state
        results.push({
          isOk: true,
          tool: "spawn_enemies",
          args: spawnEnemiesArgs.data,
          event: spawnEnemyResult.event,
        })
        break
      }
      case "change_location": {
        const changeLocationArgs = ToolArgsSchemas.change_location.safeParse(call.args)
        if (!changeLocationArgs.success) {
          fail(call.name, z.prettifyError(changeLocationArgs.error))
          continue
        }

        const changeLocationResult = changeLocation(draft, changeLocationArgs.data)
        if (!changeLocationResult.isOk) {
          fail(call.name, changeLocationResult.errorText)
          continue
        }

        draft = changeLocationResult.state
        results.push({
          isOk: true,
          tool: "change_location",
          args: changeLocationArgs.data,
          event: changeLocationResult.event,
        })
        break
      }
      default: {
        const unreachable: never = call.name
        throw new Error(`Unhandled tool: ${unreachable}`)
      }
    }
  }

  return { state: draft, results }
}

export function findStartOfLastActions(messages: StoryMessage[], actionCount: number) {
  let actionIndex = 0
  let playerTextCount = 0

  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]
    if (message.messageType === "player_text") {
      playerTextCount++
      actionIndex = i
      if (playerTextCount === actionCount) break
    }
  }

  return actionIndex
}

export function compactHistory(
  messages: StoryMessage[],
  actionsToKeepFull: number,
): StoryMessage[] {
  const firstFullActionIndex = findStartOfLastActions(messages, actionsToKeepFull)

  if (firstFullActionIndex) {
    return messages.filter(
      (m, index) =>
        index >= firstFullActionIndex ||
        m.messageType === "player_text" ||
        m.messageType === "model_text",
    )
  }

  return messages
}

export function splitHistoryForSummary(
  messages: StoryMessage[],
  actionsToKeepFull: number,
  oldActionsToSummarize: number,
): SplitHistoryForSummaryResult {
  const messagesToSummarize: StoryMessage[] = []
  const endOfCompactedMessages = findStartOfLastActions(messages, actionsToKeepFull)
  let compactedMessageCounter = 0

  for (let i = 0; i < endOfCompactedMessages; i++) {
    if (messages[i].messageType === "player_text") {
      compactedMessageCounter++
    }
  }

  if (compactedMessageCounter >= oldActionsToSummarize) {
    return {
      messagesToSummarize: messages.slice(0, endOfCompactedMessages),
      messagesToKeep: messages.slice(endOfCompactedMessages),
    }
  }

  return { messagesToSummarize, messagesToKeep: messages }
}

export class Master {
  private readonly _roomId: string
  private readonly _store: ActionStore
  private _messages: StoryMessage[] = []
  private readonly _model: ModelProvider
  private readonly _rng: Rng
  private readonly _maxRounds: number
  private readonly _actionsToKeepFull: number
  private readonly _oldActionsToSummarize: number
  private _summary: string = ""

  constructor(
    store: ActionStore,
    roomId: string,
    model: ModelProvider,
    rng: Rng = Math.random,
    // Max model calls (rounds) per player message; the action is cancelled when exceeded.
    // Not related to combat rounds.
    maxRounds: number = 5,
    // Last n actions will be kept fully, while others compacted
    actionsToKeepFull: number = 2,
    // Once m old (compacted) actions pile up, all of them are folded into the story summary
    oldActionsToSummarize: number = 3,
  ) {
    if (!Number.isInteger(maxRounds) || maxRounds <= 0)
      throw new Error("Max rounds must be an integer greater than 0")
    if (!Number.isInteger(actionsToKeepFull) || actionsToKeepFull <= 0)
      throw new Error("Actions kept full must be an integer greater than 0")
    if (!Number.isInteger(oldActionsToSummarize) || oldActionsToSummarize <= 0)
      throw new Error("Actions to summarize must be an integer greater than 0")

    this._store = store
    this._roomId = roomId
    this._model = model
    this._rng = rng
    this._maxRounds = maxRounds
    this._actionsToKeepFull = actionsToKeepFull
    this._oldActionsToSummarize = oldActionsToSummarize
  }

  async handleMessage(text: string): Promise<string> {
    let draft = await this._store.startAction(this._roomId)
    try {
      const messages: StoryMessage[] = [{ messageType: "player_text", text }]

      for (let i = 0; i < this._maxRounds; i++) {
        const instructions =
          modelDefinition.modelInstruction +
          (this._summary ? "\n" + "Story so far: " + this._summary : "") +
          "\n" +
          "Current game state: " +
          JSON.stringify(draft)
        const modelResponse = await this._model.generate(
          [...this._messages, ...messages],
          toolDefinitions,
          instructions,
        )
        messages.push(modelResponse)
        switch (modelResponse.messageType) {
          case "model_text": {
            await this._store.commitAction(this._roomId, draft)
            this._messages.push(...messages)
            this._messages = compactHistory(this._messages, this._actionsToKeepFull)
            const { messagesToSummarize, messagesToKeep } = splitHistoryForSummary(
              this._messages,
              this._actionsToKeepFull,
              this._oldActionsToSummarize,
            )

            if (messagesToSummarize.length) {
              try {
                const summarizationModelResponse = await this._model.generate(
                  messagesToSummarize,
                  [],
                  modelDefinition.summaryInstruction + "\n" + `Summary so far: ${this._summary}`,
                )
                if (summarizationModelResponse.messageType === "model_text") {
                  this._summary = summarizationModelResponse.text
                  this._messages = messagesToKeep
                } else {
                  throw new Error(
                    `Invalid summarization model response: ${JSON.stringify(summarizationModelResponse)}`,
                  )
                }
              } catch (e) {
                console.error("Failed to summarize history", e)
              }
            }

            return modelResponse.text
          }
          case "tool_calls": {
            const executionResult = executeTools(modelResponse.calls, draft, this._rng)
            draft = executionResult.state
            messages.push({ messageType: "tool_results", results: executionResult.results })
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
