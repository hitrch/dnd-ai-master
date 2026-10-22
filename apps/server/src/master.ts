import type { Content } from "@google/genai";
import type {ActionStore} from "./types";

export class Master {
  private readonly _roomId: string
  private readonly _store: ActionStore
  private readonly _messages: Content[] = []

  constructor(store: ActionStore, roomId: string) {
    this._store = store
    this._roomId = roomId
  }
}