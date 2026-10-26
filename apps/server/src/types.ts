import type {GameRecord, GameState, ToolName} from "@dnd/shared"

export interface ActionStore {
  startAction: (roomId: string) => Promise<GameState>
  commitAction: (roomId: string, state: GameState) => Promise<void>
  cancelAction: (roomId: string) => Promise<void>
}

export type ToolCall = {
  name: string
  args: Record<string, unknown>
  // Opaque provider data that must be sent back with the call in history (Gemini thought signature)
  signature?: string
}

export type ToolRunResult = {
  state: GameState
  records: GameRecord[]
}

export type StoryMessage =
  | {
  messageType: "player_text"
  text: string
} | ModelResponse
  | {
  messageType: "tool_results"
  records: GameRecord[]
}

export type ModelResponse =
  | {
  messageType: "model_text"
  text: string
}
  | {
  messageType: "tool_calls"
  calls: [ToolCall, ...ToolCall[]]
}

export interface ToolDefinition {
  name: ToolName
  description: string
  argsSchema: Record<string, unknown>
}

export interface ModelProvider {
  generate(messages: StoryMessage[], tools: ToolDefinition[]): Promise<ModelResponse>
}
