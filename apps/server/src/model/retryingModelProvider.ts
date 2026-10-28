import type {ModelProvider, ModelResponse, StoryMessage, ToolDefinition} from "./types";
import { setTimeout as delay } from "node:timers/promises"
import {ModelError} from "./modelError";


export interface RetryOptions {
  maxAttempts: number,
  baseDelayMs: number,
  sleep?: (ms: number) => Promise<void>
}

export class RetryingModelProvider implements ModelProvider {
  private readonly _modelProvider: ModelProvider
  private readonly _options: RetryOptions
  private readonly _sleep: (ms: number) => Promise<void>

  constructor(
    modelProvider: ModelProvider,
    options: RetryOptions
  ) {
    this._modelProvider = modelProvider
    this._options = options
    this._sleep = options.sleep ?? delay
  }

  async generate(messages: StoryMessage[], tools: ToolDefinition[], systemInstruction: string): Promise<ModelResponse> {
    for(let attempt = 1;; attempt++) {
      try {
        return await this._modelProvider.generate(messages, tools, systemInstruction)
      } catch (error) {
        if (attempt >= this._options.maxAttempts || !(error instanceof ModelError) || !error.isRetryable) {
          throw error
        }
        await this._sleep(this._options.baseDelayMs * (2 ** (attempt - 1)))
      }
    }
  }
}
