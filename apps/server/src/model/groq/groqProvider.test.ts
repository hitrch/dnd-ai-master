import { test } from "node:test";
import assert from "node:assert/strict";
import { APIConnectionError, APIConnectionTimeoutError, APIError } from "groq-sdk";
import type {
  ChatCompletion,
  ChatCompletionAssistantMessageParam,
  ChatCompletionMessageParam,
  ChatCompletionMessageToolCall,
  ChatCompletionToolMessageParam,
} from "groq-sdk/resources/chat";
import type { GameRecord } from "@dnd/shared";
import {
  translateCompletionToModelResponse,
  translateStoryMessagesToMessages,
  translateToModelError,
  translateToolDefinitionsToTools,
} from "./groqProvider";
import { toolDefinitions } from "../../master/toolDefinitions";
import type { StoryMessage, ToolCall } from "../types";
import { ModelError } from "../modelError";

const instruction = "You are the master.";

const checkRecord: GameRecord = {
  tool: "roll_check",
  args: { characterId: "p1", skill: "stealth", dc: 12 },
  event: {
    characterId: "p1",
    characterName: "Арвен",
    skill: "stealth",
    roll: 11,
    modifier: 5,
    total: 16,
    dc: 12,
    success: true,
  },
};

const damageRecord: GameRecord = {
  tool: "apply_damage",
  args: { targetId: "e1", amount: 3 },
  event: { targetId: "e1", targetName: "Гоблин-часовой", amount: 3, hpBefore: 7, hpAfter: 4, isDefeated: false },
};

const secondDamageRecord: GameRecord = {
  tool: "apply_damage",
  args: { targetId: "e2", amount: 5 },
  event: { targetId: "e2", targetName: "Гоблин-лучник", amount: 5, hpBefore: 5, hpAfter: 0, isDefeated: true },
};

const checkCall: ToolCall = { name: "roll_check", args: checkRecord.args };
const damageCall: ToolCall = { name: "apply_damage", args: damageRecord.args };
const secondDamageCall: ToolCall = { name: "apply_damage", args: secondDamageRecord.args };

// Builds a Groq answer with one choice, like the SDK returns it
function completion(
  message: { content: string | null; tool_calls?: ChatCompletionMessageToolCall[] },
  finishReason: ChatCompletion.Choice["finish_reason"] = "stop",
): ChatCompletion {
  return {
    id: "chatcmpl-1",
    object: "chat.completion",
    created: 0,
    model: "openai/gpt-oss-120b",
    choices: [{ index: 0, finish_reason: finishReason, logprobs: null, message: { role: "assistant", ...message } }],
  };
}

function groqCall(id: string, name: string, args: string): ChatCompletionMessageToolCall {
  return { id, type: "function", function: { name, arguments: args } };
}

function assistantCalls(m: ChatCompletionMessageParam | undefined): ChatCompletionMessageToolCall[] {
  assert.equal(m?.role, "assistant");
  const calls = (m as ChatCompletionAssistantMessageParam).tool_calls;
  assert.ok(calls);
  return calls;
}

function toolMessage(m: ChatCompletionMessageParam | undefined): ChatCompletionToolMessageParam {
  assert.equal(m?.role, "tool");
  return m as ChatCompletionToolMessageParam;
}

// ---------- translateToolDefinitionsToTools ----------

test("toTools: one function tool per definition, schema goes to parameters", () => {
  const tools = translateToolDefinitionsToTools(toolDefinitions);
  assert.equal(tools.length, toolDefinitions.length);
  tools.forEach((tool, i) => {
    const td = toolDefinitions[i]!;
    assert.deepEqual(tool, {
      type: "function",
      function: { name: td.name, description: td.description, parameters: td.argsSchema },
    });
  });
});

test("toTools: no definitions give no tools", () => {
  assert.deepEqual(translateToolDefinitionsToTools([]), []);
});

// ---------- translateToModelError ----------

test("toModelError: a ModelError is returned as is", () => {
  const original = new ModelError("already translated", false);
  assert.equal(translateToModelError(original), original);
});

test("toModelError: 429 and 5xx are retryable, the SDK error is the cause", () => {
  for (const status of [429, 500, 503]) {
    const apiError = APIError.generate(status, undefined, `status ${status}`, new Headers());
    const e = translateToModelError(apiError);
    assert.equal(e.isRetryable, true, `status ${status}`);
    assert.equal(e.cause, apiError);
  }
});

test("toModelError: other statuses are not retryable", () => {
  for (const status of [400, 401, 403, 404]) {
    const e = translateToModelError(APIError.generate(status, undefined, `status ${status}`, new Headers()));
    assert.equal(e.isRetryable, false, `status ${status}`);
  }
});

test("toModelError: a timeout is retryable", () => {
  const timeout = new APIConnectionTimeoutError();
  const e = translateToModelError(timeout);
  assert.equal(e.isRetryable, true);
  assert.equal(e.cause, timeout);
});

test("toModelError: a connection failure is retryable", () => {
  const e = translateToModelError(new APIConnectionError({ message: "fetch failed" }));
  assert.equal(e.isRetryable, true);
});

test("toModelError: any other error is retryable and keeps its message", () => {
  const e = translateToModelError(new SyntaxError("Unexpected token"));
  assert.ok(e instanceof ModelError);
  assert.equal(e.isRetryable, true);
  assert.match(e.message, /Unexpected token/);
});

test("toModelError: a thrown non-Error value becomes a ModelError with its text", () => {
  const e = translateToModelError("boom");
  assert.ok(e instanceof ModelError);
  assert.match(e.message, /boom/);
});

// ---------- translateCompletionToModelResponse ----------

test("toModelResponse: text becomes model_text", () => {
  const r = translateCompletionToModelResponse(completion({ content: "Дверь скрипит." }));
  assert.deepEqual(r, { messageType: "model_text", text: "Дверь скрипит." });
});

test("toModelResponse: tool calls become tool_calls with parsed args", () => {
  const r = translateCompletionToModelResponse(
    completion(
      {
        content: null,
        tool_calls: [
          groqCall("a", "roll_check", JSON.stringify(checkRecord.args)),
          groqCall("b", "apply_damage", JSON.stringify(damageRecord.args)),
        ],
      },
      "tool_calls",
    ),
  );
  assert.equal(r.messageType, "tool_calls");
  assert.ok(r.messageType === "tool_calls");
  assert.deepEqual(
    r.calls.map(c => ({ name: c.name, args: c.args })),
    [
      { name: "roll_check", args: checkRecord.args },
      { name: "apply_damage", args: damageRecord.args },
    ],
  );
});

test("toModelResponse: text together with tool calls gives tool_calls", () => {
  const r = translateCompletionToModelResponse(
    completion({ content: "Сейчас проверим.", tool_calls: [groqCall("a", "roll_check", "{}")] }, "tool_calls"),
  );
  assert.equal(r.messageType, "tool_calls");
});

test("toModelResponse: empty tool_calls with text gives model_text", () => {
  const r = translateCompletionToModelResponse(completion({ content: "Тишина.", tool_calls: [] }));
  assert.deepEqual(r, { messageType: "model_text", text: "Тишина." });
});

test("toModelResponse: no choices throws", () => {
  const empty = { ...completion({ content: "x" }), choices: [] };
  assert.throws(() => translateCompletionToModelResponse(empty));
});

test("toModelResponse: no text and no calls throws with the finish reason", () => {
  assert.throws(() => translateCompletionToModelResponse(completion({ content: null }, "length")), /length/);
  assert.throws(() => translateCompletionToModelResponse(completion({ content: "" }, "length")), /length/);
});

test("toModelResponse: broken JSON in arguments throws", () => {
  assert.throws(() =>
    translateCompletionToModelResponse(completion({ content: null, tool_calls: [groqCall("a", "roll_check", "{oops")] })),
  );
});

test("toModelResponse: arguments that are not an object throw and name the tool", () => {
  for (const args of ["null", "[]", "7", '"text"']) {
    assert.throws(
      () => translateCompletionToModelResponse(completion({ content: null, tool_calls: [groqCall("a", "roll_check", args)] })),
      /roll_check/,
      `arguments ${args}`,
    );
  }
});

// ---------- translateStoryMessagesToMessages ----------

test("toMessages: the system instruction comes first, even with an empty history", () => {
  assert.deepEqual(translateStoryMessagesToMessages([], instruction), [{ role: "system", content: instruction }]);
});

test("toMessages: player text becomes user, model text becomes assistant", () => {
  const m = translateStoryMessagesToMessages(
    [
      { messageType: "player_text", text: "Открываю дверь." },
      { messageType: "model_text", text: "Дверь скрипит." },
    ],
    instruction,
  );
  assert.deepEqual(m.slice(1), [
    { role: "user", content: "Открываю дверь." },
    { role: "assistant", content: "Дверь скрипит." },
  ]);
});

test("toMessages: tool calls become one assistant message with stringified args", () => {
  const m = translateStoryMessagesToMessages([{ messageType: "tool_calls", calls: [checkCall, damageCall] }], instruction);
  assert.equal(m.length, 2);
  const calls = assistantCalls(m[1]);
  assert.deepEqual(
    calls.map(c => ({ type: c.type, name: c.function.name, args: JSON.parse(c.function.arguments) })),
    [
      { type: "function", name: "roll_check", args: checkRecord.args },
      { type: "function", name: "apply_damage", args: damageRecord.args },
    ],
  );
});

test("toMessages: each record becomes its own tool message with the event and the id of its call", () => {
  const history: StoryMessage[] = [
    { messageType: "player_text", text: "Крадусь и бью гоблина." },
    { messageType: "tool_calls", calls: [checkCall, damageCall] },
    { messageType: "tool_results", records: [checkRecord, damageRecord] },
  ];
  const m = translateStoryMessagesToMessages(history, instruction);
  assert.equal(m.length, 5);
  const calls = assistantCalls(m[2]);
  const first = toolMessage(m[3]);
  const second = toolMessage(m[4]);
  assert.equal(first.tool_call_id, calls[0]!.id);
  assert.equal(second.tool_call_id, calls[1]!.id);
  assert.deepEqual(JSON.parse(first.content as string), checkRecord.event);
  assert.deepEqual(JSON.parse(second.content as string), damageRecord.event);
});

test("toMessages: two calls of the same tool in one message get different ids", () => {
  const history: StoryMessage[] = [
    { messageType: "tool_calls", calls: [damageCall, secondDamageCall] },
    { messageType: "tool_results", records: [damageRecord, secondDamageRecord] },
  ];
  const m = translateStoryMessagesToMessages(history, instruction);
  const calls = assistantCalls(m[1]);
  assert.notEqual(calls[0]!.id, calls[1]!.id);
  assert.equal(toolMessage(m[2]).tool_call_id, calls[0]!.id);
  assert.equal(toolMessage(m[3]).tool_call_id, calls[1]!.id);
});

test("toMessages: results of a later round point to the calls of that round", () => {
  const history: StoryMessage[] = [
    { messageType: "player_text", text: "Крадусь." },
    { messageType: "tool_calls", calls: [checkCall] },
    { messageType: "tool_results", records: [checkRecord] },
    { messageType: "model_text", text: "Гоблин не заметил." },
    { messageType: "player_text", text: "Бью его." },
    { messageType: "tool_calls", calls: [damageCall] },
    { messageType: "tool_results", records: [damageRecord] },
  ];
  const m = translateStoryMessagesToMessages(history, instruction);
  const laterCalls = assistantCalls(m[6]);
  assert.equal(toolMessage(m[7]).tool_call_id, laterCalls[0]!.id);
});

test("toMessages: call ids are unique across the whole history", () => {
  // The same tool in two rounds: ids must not repeat, otherwise a result could be matched to an old call
  const history: StoryMessage[] = [
    { messageType: "tool_calls", calls: [checkCall] },
    { messageType: "tool_results", records: [checkRecord] },
    { messageType: "tool_calls", calls: [checkCall] },
    { messageType: "tool_results", records: [checkRecord] },
  ];
  const m = translateStoryMessagesToMessages(history, instruction);
  const ids = [...assistantCalls(m[1]), ...assistantCalls(m[3])].map(c => c.id);
  assert.equal(new Set(ids).size, ids.length);
});

test("toMessages: a result without a call before it throws", () => {
  assert.throws(() =>
    translateStoryMessagesToMessages([{ messageType: "tool_results", records: [checkRecord] }], instruction),
  );
});

test("toMessages: more results than calls throws", () => {
  const history: StoryMessage[] = [
    { messageType: "tool_calls", calls: [checkCall] },
    { messageType: "tool_results", records: [checkRecord, damageRecord] },
  ];
  assert.throws(() => translateStoryMessagesToMessages(history, instruction));
});