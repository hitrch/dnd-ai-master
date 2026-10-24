import type {GameRecord, GameState, Tool} from "@dnd/shared"

export interface ActionStore {
  startAction: (roomId: string) => Promise<GameState>
  commitAction: (roomId: string, state: GameState) => Promise<void>
  cancelAction: (roomId: string) => Promise<void>
}

export type ToolCall = {
  name: string
  args: unknown
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

export interface ModelProvider {
  generate(messages: StoryMessage[], tools: Tool[]): Promise<ModelResponse>
}
