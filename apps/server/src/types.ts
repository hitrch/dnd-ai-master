import type { GameRecord, GameState } from "@dnd/shared"

export interface ActionStore {
  startAction: (roomId: string) => Promise<GameState>
  commitAction: (roomId: string, state: GameState) => Promise<void>
  cancelAction: (roomId: string) => Promise<void>
}

export type ToolResult =
  ({ isOk: true } & GameRecord) | { isOk: false; tool: string; errorText: string }

export type ToolRunResult = {
  results: ToolResult[]
  state: GameState
}
