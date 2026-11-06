export interface ModelErrorOptions extends ErrorOptions {
  retryAfterMs?: number
}

export class ModelError extends Error {
  private readonly _isRetryable: boolean
  private readonly _retryAfterMs: number | undefined

  constructor(message: string, isRetryable: boolean, options?: ModelErrorOptions) {
    super(message, options)
    this.name = "ModelError"
    this._isRetryable = isRetryable
    this._retryAfterMs = options?.retryAfterMs
  }

  get isRetryable(): boolean {
    return this._isRetryable
  }

  get retryAfterMs(): number | undefined {
    return this._retryAfterMs
  }
}
