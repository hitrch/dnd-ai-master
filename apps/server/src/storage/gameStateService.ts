import type {GameState} from "@dnd/shared";
import {randomUUID} from "node:crypto";
import type {ActionStore} from "../types";

export class GameStateService implements ActionStore {
  private readonly _rooms: Map<string, {state: GameState, isLocked: boolean}> = new Map()

  async createRoom(state: GameState): Promise<string> {
    const id = randomUUID()
    this._rooms.set(id, {state: structuredClone(state), isLocked: false})
    return id
  }

  async getRoomById(id: string): Promise<GameState | undefined> {
    return structuredClone(this._rooms.get(id)?.state)
  }

  async deleteRoomById(id: string): Promise<boolean> {
    //todo here delete from db
    return this._rooms.delete(id)
  }

  async startAction(id: string): Promise<GameState> {
    const room = this._rooms.get(id)
    if(!room) throw new Error(`Room with id ${id} not found`)
    if(room.isLocked) throw new Error(`Room with id ${id} has active action`)
    room.isLocked = true
    return structuredClone(room.state)
  }

  async commitAction(id: string, state: GameState): Promise<void> {
    const room = this._rooms.get(id)
    if(!room) throw new Error(`Room with id ${id} not found`)
    if(!room.isLocked) throw new Error(`Room with id ${id} has no active action`)
    this._rooms.set(id, {state: structuredClone(state), isLocked: false})
  }

  async cancelAction(id: string): Promise<void> {
    const room = this._rooms.get(id)
    if(!room) throw new Error(`Room with id ${id} not found`)
    if(!room.isLocked) throw new Error(`Room with id ${id} has no active action`)
    this._rooms.set(id, {state: room.state, isLocked: false})
  }
}
