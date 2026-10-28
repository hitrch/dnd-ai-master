export class ModelError extends Error {
  private readonly _isRetryable: boolean

  constructor(message: string, isRetryable: boolean, options?: ErrorOptions) {
    super(message, options)
    this.name = "ModelError"
    this._isRetryable = isRetryable
  }

  get isRetryable(): boolean {
    return this._isRetryable
  }
}
