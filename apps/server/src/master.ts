import type { GameState } from "@dnd/shared";
import type { Content } from "@google/genai";

export class Master {
  private _state: GameState;
  private _messages: Content[] = [];

  constructor(state: GameState) {
    this._state = state;
  }

  get state(): GameState {
    return this._state;
  }
}