import type {GameRecord, GameState} from "@dnd/shared"

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
