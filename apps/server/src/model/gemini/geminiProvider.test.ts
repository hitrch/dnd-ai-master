import { test } from "node:test";
import assert from "node:assert/strict";
import { ApiError, GenerateContentResponse } from "@google/genai";
import type { Part } from "@google/genai";
import type { GameRecord } from "@dnd/shared";
import {
  translateContentResponseToModelResponse,
  translateStoryMessagesToContent,
  translateToModelError,
  translateToolDefinitionsToTools,
} from "./geminiProvider";
import { toolDefinitions } from "../../master/toolDefinitions";
import type { ToolDefinition } from "../types";
import { ModelError } from "../modelError";

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

// Builds a real SDK response so the text / functionCalls getters work as in production
function geminiResponse(parts: Part[] | undefined): GenerateContentResponse {
  const r = new GenerateContentResponse();
  r.candidates = parts === undefined ? [] : [{ content: { role: "model", parts } }];
  return r;
}

// ---------- translateStoryMessagesToContent ----------

test("toContent: player text becomes a user text part", () => {
  const c = translateStoryMessagesToContent([{ messageType: "player_text", text: "Привет" }]);
  assert.deepEqual(c, [{ role: "user", parts: [{ text: "Привет" }] }]);
});

test("toContent: model text becomes a model text part", () => {
  const c = translateStoryMessagesToContent([{ messageType: "model_text", text: "Тишина." }]);
  assert.deepEqual(c, [{ role: "model", parts: [{ text: "Тишина." }] }]);
});

test("toContent: tool calls become one model content with a functionCall part per call", () => {
  const c = translateStoryMessagesToContent([
    {
      messageType: "tool_calls",
      calls: [
        { name: "roll_check", args: { characterId: "p1", skill: "stealth", dc: 12 } },
        { name: "apply_damage", args: { targetId: "e1", amount: 3 } },
      ],
    },
  ]);
  assert.deepEqual(c, [
    {
      role: "model",
      parts: [
        { functionCall: { name: "roll_check", args: { characterId: "p1", skill: "stealth", dc: 12 } } },
        { functionCall: { name: "apply_damage", args: { targetId: "e1", amount: 3 } } },
      ],
    },
  ]);
});

test("toContent: tool results become one user content with a functionResponse per record", () => {
  const c = translateStoryMessagesToContent([
    { messageType: "tool_results", records: [checkRecord, damageRecord] },
  ]);
  assert.deepEqual(c, [
    {
      role: "user",
      parts: [
        { functionResponse: { name: "roll_check", response: checkRecord.event } },
        { functionResponse: { name: "apply_damage", response: damageRecord.event } },
      ],
    },
  ]);
});

test("toContent: order and count of messages are preserved", () => {
  const c = translateStoryMessagesToContent([
    { messageType: "player_text", text: "Бью" },
    { messageType: "tool_calls", calls: [{ name: "apply_damage", args: { targetId: "e1", amount: 3 } }] },
    { messageType: "tool_results", records: [damageRecord] },
    { messageType: "model_text", text: "Ранен." },
  ]);
  assert.deepEqual(
    c.map((x) => x.role),
    ["user", "model", "user", "model"],
  );
});

test("toContent: empty history gives empty contents", () => {
  assert.deepEqual(translateStoryMessagesToContent([]), []);
});

// ---------- translateContentResponseToModelResponse ----------

test("fromResponse: text only becomes model_text", () => {
  const r = translateContentResponseToModelResponse(geminiResponse([{ text: "Тишина." }]));
  assert.deepEqual(r, { messageType: "model_text", text: "Тишина." });
});

test("fromResponse: several text parts are joined into one text", () => {
  const r = translateContentResponseToModelResponse(geminiResponse([{ text: "Тиши" }, { text: "на." }]));
  assert.deepEqual(r, { messageType: "model_text", text: "Тишина." });
});

test("fromResponse: function calls become tool_calls in order", () => {
  const r = translateContentResponseToModelResponse(
    geminiResponse([
      { functionCall: { name: "roll_check", args: { characterId: "p1", skill: "stealth", dc: 12 } } },
      { functionCall: { name: "apply_damage", args: { targetId: "e1", amount: 3 } } },
    ]),
  );
  assert.deepEqual(r, {
    messageType: "tool_calls",
    calls: [
      { name: "roll_check", args: { characterId: "p1", skill: "stealth", dc: 12 } },
      { name: "apply_damage", args: { targetId: "e1", amount: 3 } },
    ],
  });
});

test("fromResponse: call without args gets an empty args object", () => {
  const r = translateContentResponseToModelResponse(geminiResponse([{ functionCall: { name: "roll_check" } }]));
  assert.deepEqual(r, { messageType: "tool_calls", calls: [{ name: "roll_check", args: {} }] });
});

test("fromResponse: text together with calls gives tool_calls", () => {
  const r = translateContentResponseToModelResponse(
    geminiResponse([
      { text: "Посмотрим..." },
      { functionCall: { name: "apply_damage", args: { targetId: "e1", amount: 3 } } },
    ]),
  );
  assert.equal(r.messageType, "tool_calls");
});

test("fromResponse: call without a name throws", () => {
  assert.throws(() =>
    translateContentResponseToModelResponse(geminiResponse([{ functionCall: { args: { amount: 3 } } }])),
  );
});

test("fromResponse: no candidates throws", () => {
  assert.throws(() => translateContentResponseToModelResponse(geminiResponse(undefined)));
});

test("fromResponse: empty parts throws", () => {
  assert.throws(() => translateContentResponseToModelResponse(geminiResponse([])));
});

test("fromResponse: empty text throws", () => {
  assert.throws(() => translateContentResponseToModelResponse(geminiResponse([{ text: "" }])));
});

test("fromResponse: round trip of tool calls keeps names and args", () => {
  const calls = [{ name: "apply_damage", args: { targetId: "e1", amount: 3 } }];
  const [content] = translateStoryMessagesToContent([{ messageType: "tool_calls", calls: [calls[0]] }]);
  const r = translateContentResponseToModelResponse(geminiResponse(content.parts));
  assert.deepEqual(r, { messageType: "tool_calls", calls });
});

// ---------- thought signature ----------

test("signature: thought signature of a call is kept in tool_calls", () => {
  const r = translateContentResponseToModelResponse(
    geminiResponse([
      { functionCall: { name: "roll_check", args: { dc: 12 } }, thoughtSignature: "sig1" },
      { functionCall: { name: "apply_damage", args: { amount: 3 } } },
    ]),
  );
  assert.deepEqual(r, {
    messageType: "tool_calls",
    calls: [
      { name: "roll_check", args: { dc: 12 }, signature: "sig1" },
      { name: "apply_damage", args: { amount: 3 } },
    ],
  });
});

test("signature: signature is sent back in the same part as the call", () => {
  const c = translateStoryMessagesToContent([
    {
      messageType: "tool_calls",
      calls: [
        { name: "roll_check", args: { dc: 12 }, signature: "sig1" },
        { name: "apply_damage", args: { amount: 3 } },
      ],
    },
  ]);
  assert.deepEqual(c, [
    {
      role: "model",
      parts: [
        { functionCall: { name: "roll_check", args: { dc: 12 } }, thoughtSignature: "sig1" },
        { functionCall: { name: "apply_damage", args: { amount: 3 } } },
      ],
    },
  ]);
});

test("signature: call without a signature has no signature key at all", () => {
  const r = translateContentResponseToModelResponse(geminiResponse([{ functionCall: { name: "roll_check" } }]));
  assert.ok(r.messageType === "tool_calls");
  assert.equal(Object.hasOwn(r.calls[0], "signature"), false);
  const [content] = translateStoryMessagesToContent([r]);
  assert.equal(Object.hasOwn(content.parts?.[0] ?? {}, "thoughtSignature"), false);
});

test("signature: round trip keeps the signature", () => {
  const parts: Part[] = [{ functionCall: { name: "roll_check", args: { dc: 12 } }, thoughtSignature: "sig1" }];
  const r = translateContentResponseToModelResponse(geminiResponse(parts));
  assert.ok(r.messageType === "tool_calls");
  const [content] = translateStoryMessagesToContent([r]);
  assert.deepEqual(content.parts, parts);
});

// ---------- translateToolDefinitionsToTools ----------

test("toTools: definitions become one tool with a function declaration per definition", () => {
  const definitions: ToolDefinition[] = [
    { name: "roll_check", description: "Check", argsSchema: { type: "object", properties: { dc: { type: "number" } } } },
    { name: "apply_damage", description: "Damage", argsSchema: { type: "object" } },
  ];
  assert.deepEqual(translateToolDefinitionsToTools(definitions), [
    {
      functionDeclarations: [
        {
          name: "roll_check",
          description: "Check",
          parametersJsonSchema: { type: "object", properties: { dc: { type: "number" } } },
        },
        { name: "apply_damage", description: "Damage", parametersJsonSchema: { type: "object" } },
      ],
    },
  ]);
});

test("toTools: every real tool definition is declared", () => {
  const [tool] = translateToolDefinitionsToTools(toolDefinitions);
  assert.deepEqual(
    tool.functionDeclarations?.map((d) => d.name),
    toolDefinitions.map((d) => d.name),
  );
});

function apiError(status: number): ApiError {
  return new ApiError({ message: `{"error":{"code":${status}}}`, status });
}

test("toModelError: 429 is retryable", () => {
  assert.equal(translateToModelError(apiError(429)).isRetryable, true);
});

test("toModelError: 500 and 503 are retryable", () => {
  assert.equal(translateToModelError(apiError(500)).isRetryable, true);
  assert.equal(translateToModelError(apiError(503)).isRetryable, true);
});

test("toModelError: 400, 401, 403, 404 are not retryable", () => {
  for (const status of [400, 401, 403, 404]) {
    assert.equal(translateToModelError(apiError(status)).isRetryable, false, `status ${status}`);
  }
});

test("toModelError: api error keeps the original error as cause", () => {
  const original = apiError(503);
  const result = translateToModelError(original);
  assert.equal(result.cause, original);
  assert.match(result.message, /503/);
});

test("toModelError: timeout (AbortError) is retryable and keeps the cause", () => {
  // fetch rejects with a DOMException named AbortError when the SDK timeout fires
  const original = new DOMException("This operation was aborted", "AbortError");
  const result = translateToModelError(original);
  assert.equal(result.isRetryable, true);
  assert.equal(result.cause, original);
});

test("toModelError: other errors are wrapped with message and cause", () => {
  const original = new TypeError("fetch failed");
  const result = translateToModelError(original);
  assert.ok(result instanceof ModelError);
  assert.match(result.message, /fetch failed/);
  assert.equal(result.cause, original);
});

test("toModelError: non-Error value is wrapped with its text", () => {
  const result = translateToModelError("boom");
  assert.ok(result instanceof ModelError);
  assert.match(result.message, /boom/);
});

test("toModelError: ModelError is returned as is", () => {
  const original = translateToModelError("boom");
  assert.equal(translateToModelError(original), original);
});

test("toModelError: result is an Error named ModelError", () => {
  const result = translateToModelError(apiError(503));
  assert.ok(result instanceof Error);
  assert.equal(result.name, "ModelError");
});
