import {GoogleGenAI} from "@google/genai";
import type {Content, GenerateContentResponse, Tool} from "@google/genai";
import type {ModelProvider, ModelResponse, StoryMessage, ToolCall, ToolDefinition} from "./types";
import {isArrayNotEmpty} from "./utils";

export function translateStoryMessagesToContent(messages: StoryMessage[]): Content[] {
  const content: Content[] = []
  for(const message of messages) {
    switch (message.messageType) {
      case "player_text": {
        content.push({role: "user", parts: [{text: message.text}]})
        break
      }
      case "tool_results": {
        const parts = message.records.map(r => {
          return {
            functionResponse: {
              name: r.tool,
              response: r.event
            }
          }
        })
        content.push({role: "user", parts: parts})
        break
      }
      case "model_text": {
        content.push({role: "model", parts: [{text: message.text}]})
        break
      }
      case "tool_calls": {
        const parts = message.calls.map(c => {
          return {
            functionCall: {
              name: c.name,
              args: c.args
            },
            ...(c.signature ? {thoughtSignature: c.signature} : {})
          }
        })
        content.push({role: "model", parts: parts})
        break
      }
      default: {
        const unreachable: never = message
        throw new Error(`Unhandled message type: ${JSON.stringify(unreachable)}`)
      }
    }
  }
  return content
}

export function translateContentResponseToModelResponse(response: GenerateContentResponse): ModelResponse {
  // Read parts directly: the functionCalls getter drops the thought signature that sits next to each call
  const parts = response.candidates?.[0]?.content?.parts ?? []
  const calls: ToolCall[] = []
  for(const part of parts) {
    const c = part.functionCall
    if(!c) continue
    if(!c.name) throw new Error(`Invalid function call: ${JSON.stringify(c)}`)
    calls.push({name: c.name, args: c.args ?? {}, ...(part.thoughtSignature ? {signature: part.thoughtSignature} : {})})
  }
  if(isArrayNotEmpty(calls)) return {messageType: "tool_calls", calls: calls}
  if(response.text) return {messageType: "model_text",  text: response.text}
  throw new Error(`Invalid response: no text and no tool calls, finishReason: ${response.candidates?.[0]?.finishReason}`)
}

export function translateToolDefinitionsToTools(toolDefinitions: ToolDefinition[]): Tool[] {
  return [{
    functionDeclarations: toolDefinitions.map(td => {
      return {name: td.name, description: td.description, parametersJsonSchema: td.argsSchema}
    })
  }]
}

export class GeminiProvider implements ModelProvider {
  private readonly _client: GoogleGenAI
  private readonly _modelName: string

  constructor(apiKey: string, modelName: string) {
    this._client = new GoogleGenAI({ apiKey })
    this._modelName = modelName
  }

  async generate(messages: StoryMessage[], toolDefinitions: ToolDefinition[], systemInstruction: string): Promise<ModelResponse> {
    const contents = translateStoryMessagesToContent(messages)
    const tools = translateToolDefinitionsToTools(toolDefinitions)
    const res = await this._client.models.generateContent({ model: this._modelName, contents, config: { tools, systemInstruction } })
    return translateContentResponseToModelResponse(res)
  }
}
