import type {GameRecord, ToolName} from "@dnd/shared"

export type ToolCall = {
  name: string
  args: Record<string, unknown>
  // Opaque provider data that must be sent back with the call in history (Gemini thought signature)
  signature?: string
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
  generate(messages: StoryMessage[], tools: ToolDefinition[], systemInstruction: string): Promise<ModelResponse>
}
