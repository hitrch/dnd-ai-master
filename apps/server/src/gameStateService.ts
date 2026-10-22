import type {GameState} from "@dnd/shared";
import {randomUUID} from "node:crypto";

export class GameStateService {
  private readonly _rooms: Map<string, GameState> = new Map()

  async createRoom(state: GameState): Promise<string> {
    const id = randomUUID()
    this._rooms.set(id, structuredClone(state))
    return id
  }

  async getRoomById(id: string): Promise<GameState | undefined> {
    return structuredClone(this._rooms.get(id))
  }

  async deleteRoomById(id: string): Promise<boolean> {
    //todo here delete from db
    return this._rooms.delete(id)
  }
}