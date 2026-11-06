import type {ModelProvider, ModelResponse, StoryMessage, ToolCall, ToolDefinition} from "../types";
import {APIError, Groq} from "groq-sdk";
import type {
  ChatCompletion,
  ChatCompletionMessageParam,
  ChatCompletionMessageToolCall,
  ChatCompletionTool
} from "groq-sdk/resources/chat";
import {ModelError} from "../modelError";
import {isArrayNotEmpty, isPlainObject} from "../../utils";

export function translateToolDefinitionsToTools(toolDefinitions: ToolDefinition[]): ChatCompletionTool[] {
  return toolDefinitions.map(td => {
    return {
      type: "function",
      function: {
        name: td.name,
        description: td.description,
        parameters: td.argsSchema
      }
    }
  })
}

function parseRetryAfterMs(headers: Headers | undefined): number | undefined {
  const retryAfterHeader = headers?.get("retry-after")
  if(retryAfterHeader === null || retryAfterHeader === undefined) return undefined
  const retryAfter = Number(retryAfterHeader)
  return Number.isFinite(retryAfter) ? retryAfter * 1000 : undefined
}

export function translateToModelError(arg: unknown): ModelError {
  if(arg instanceof ModelError) return arg
  if(arg instanceof APIError) {
    // No status means the request never got an answer: a connection failure or a timeout
    // (APIConnectionError, APIConnectionTimeoutError), both transient
    const isRetryable = !arg.status || arg.status === 429 || arg.status >= 500
    const retryAfterMs = parseRetryAfterMs(arg.headers)
    return new ModelError(arg.message, isRetryable, {cause: arg, retryAfterMs})
  }
  const errorMessage = arg instanceof Error ? arg.message : String(arg)
  // Everything else: malformed model responses (broken JSON in tool arguments, no text and no calls).
  // The model is nondeterministic, so a repeat often succeeds. Retries are bounded,
  // so a bug in our own translation code only costs a few extra attempts.
  return new ModelError(errorMessage, true, {cause: arg})
}

export function translateCompletionToModelResponse(chatCompletion: ChatCompletion): ModelResponse {
  const message = chatCompletion.choices[0]?.message
  if(!message) throw new Error(`Invalid response: no message: ${JSON.stringify(chatCompletion)}`)
  const calls: ToolCall[] = message.tool_calls?.map(toolcall => {
    if(!toolcall.function.name) throw new Error(`Invalid function call: ${JSON.stringify(toolcall)}`)
    const args: unknown = JSON.parse(toolcall.function.arguments)
    if(!isPlainObject(args)) throw new Error(`Invalid function arguments for ${toolcall.function.name}: ${toolcall.function.arguments}: ${JSON.stringify(args)}`)
    return {name: toolcall.function.name, args}
  }) ?? []
  if(isArrayNotEmpty(calls)) return {messageType: "tool_calls", calls: calls}
  if(message.content) return {messageType: "model_text",  text: message.content}
  throw new Error(`Invalid response: no text and no tool calls, finishReason: ${chatCompletion.choices[0]?.finish_reason}`)
}

export function translateStoryMessagesToMessages(messages: StoryMessage[], systemInstruction: string): ChatCompletionMessageParam[] {
  const result: ChatCompletionMessageParam[] = [{ role: "system", content: systemInstruction }]
  let lastCallIds: string[] = []
  for(let i = 0; i < messages.length; i++) {
    const message = messages[i]
    switch (message.messageType) {
      case "player_text": {
        result.push({ role: "user", content: message.text })
        break
      }
      case "model_text": {
        result.push({ role: "assistant", content: message.text })
        break
      }
      case "tool_calls": {
        const toolCalls = message.calls.map((c, callIndex): ChatCompletionMessageToolCall => {
          const callId = `${c.name}-${callIndex}-${i}`
          return {
            id: callId,
            type: "function",
            function: {
              name: c.name,
              arguments: JSON.stringify(c.args)
            }
          }
        })
        lastCallIds = toolCalls.map(c => c.id)
        result.push({ role: "assistant", tool_calls: toolCalls })
        break
      }
      case "tool_results": {
        message.records.forEach((r, recordIndex) => {
          const id = lastCallIds[recordIndex]
          if(!id) throw new Error(`Invalid tool result: no call id for record ${recordIndex}`)
          result.push({ role: "tool", tool_call_id: id, content: JSON.stringify(r.event) })
        })
        break
      }
      default: {
        const unreachable: never = message
        throw new Error(`Unhandled message type: ${JSON.stringify(unreachable)}`)
      }
    }
  }
  return result
}


export class GroqProvider implements ModelProvider {
  private readonly _client: Groq
  private readonly _modelName: string

  constructor(apiKey: string, modelName: string, timeoutMs: number) {
    this._client = new Groq({ apiKey, timeout: timeoutMs, maxRetries: 0 })
    this._modelName = modelName
  }

  async generate(messages: StoryMessage[], toolDefinitions: ToolDefinition[], systemInstruction: string): Promise<ModelResponse> {
    try {
      const groqMessages = translateStoryMessagesToMessages(messages, systemInstruction)
      const tools = translateToolDefinitionsToTools(toolDefinitions)
      const res = await this._client.chat.completions.create({ model: this._modelName, messages: groqMessages, tools })
      return translateCompletionToModelResponse(res)
    } catch (e) {
      throw translateToModelError(e)
    }
  }
}
