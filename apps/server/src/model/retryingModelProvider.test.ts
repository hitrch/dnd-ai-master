import { test } from "node:test";
import assert from "node:assert/strict";
import { RetryingModelProvider } from "./retryingModelProvider";
import { ModelError } from "./modelError";
import type { ModelProvider, ModelResponse, StoryMessage, ToolDefinition } from "./types";

const okResponse: ModelResponse = { messageType: "model_text", text: "Дверь открыта." };
const messages: StoryMessage[] = [{ messageType: "player_text", text: "Открываю дверь." }];
const tools: ToolDefinition[] = [];
const instruction = "You are the master.";

type Step = ModelResponse | Error;

// Fake provider: plays the given steps in order (response = success, error = throw) and records every call
function scriptedProvider(steps: Step[]) {
  const calls: Parameters<ModelProvider["generate"]>[] = [];
  const provider: ModelProvider = {
    async generate(...args) {
      calls.push(args);
      const step = steps[calls.length - 1];
      if (step === undefined) throw new Error("Unexpected extra call");
      if (step instanceof Error) throw step;
      return step;
    },
  };
  return { provider, calls };
}

// Fake sleep: does not wait, only records requested delays
function recordingSleep() {
  const delays: number[] = [];
  const sleep = async (ms: number) => {
    delays.push(ms);
  };
  return { sleep, delays };
}

const retryable = () => new ModelError("503 high demand", true);
const fatal = () => new ModelError("404 model not found", false);

test("retry: success on the first attempt returns the response as is, no sleep", async () => {
  const { provider, calls } = scriptedProvider([okResponse]);
  const { sleep, delays } = recordingSleep();
  const retrying = new RetryingModelProvider(provider, { maxAttempts: 3, baseDelayMs: 1000, sleep });

  const result = await retrying.generate(messages, tools, instruction);

  assert.equal(result, okResponse);
  assert.equal(calls.length, 1);
  assert.deepEqual(delays, []);
});

test("retry: retryable error then success returns the response", async () => {
  const { provider, calls } = scriptedProvider([retryable(), okResponse]);
  const { sleep } = recordingSleep();
  const retrying = new RetryingModelProvider(provider, { maxAttempts: 3, baseDelayMs: 1000, sleep });

  const result = await retrying.generate(messages, tools, instruction);

  assert.equal(result, okResponse);
  assert.equal(calls.length, 2);
});

test("retry: every attempt gets the same arguments", async () => {
  const { provider, calls } = scriptedProvider([retryable(), retryable(), okResponse]);
  const { sleep } = recordingSleep();
  const retrying = new RetryingModelProvider(provider, { maxAttempts: 3, baseDelayMs: 1000, sleep });

  await retrying.generate(messages, tools, instruction);

  for (const args of calls) {
    assert.equal(args[0], messages);
    assert.equal(args[1], tools);
    assert.equal(args[2], instruction);
  }
});

test("retry: delays grow exponentially and there is no sleep after the last attempt", async () => {
  const errors = [retryable(), retryable(), retryable(), retryable()];
  const { provider, calls } = scriptedProvider(errors);
  const { sleep, delays } = recordingSleep();
  const retrying = new RetryingModelProvider(provider, { maxAttempts: 4, baseDelayMs: 10, sleep });

  await assert.rejects(retrying.generate(messages, tools, instruction));

  assert.equal(calls.length, 4);
  assert.deepEqual(delays, [10, 20, 40]);
});

test("retry: when attempts run out the last error is thrown as is", async () => {
  const last = retryable();
  const { provider } = scriptedProvider([retryable(), retryable(), last]);
  const { sleep } = recordingSleep();
  const retrying = new RetryingModelProvider(provider, { maxAttempts: 3, baseDelayMs: 10, sleep });

  await assert.rejects(retrying.generate(messages, tools, instruction), (error) => error === last);
});

test("retry: non-retryable ModelError is thrown at once without sleep", async () => {
  const error = fatal();
  const { provider, calls } = scriptedProvider([error, okResponse]);
  const { sleep, delays } = recordingSleep();
  const retrying = new RetryingModelProvider(provider, { maxAttempts: 3, baseDelayMs: 10, sleep });

  await assert.rejects(retrying.generate(messages, tools, instruction), (e) => e === error);
  assert.equal(calls.length, 1);
  assert.deepEqual(delays, []);
});

test("retry: error that is not a ModelError is thrown at once", async () => {
  const error = new Error("bug");
  const { provider, calls } = scriptedProvider([error, okResponse]);
  const { sleep, delays } = recordingSleep();
  const retrying = new RetryingModelProvider(provider, { maxAttempts: 3, baseDelayMs: 10, sleep });

  await assert.rejects(retrying.generate(messages, tools, instruction), (e) => e === error);
  assert.equal(calls.length, 1);
  assert.deepEqual(delays, []);
});

test("retry: maxAttempts 1 means no retries", async () => {
  const error = retryable();
  const { provider, calls } = scriptedProvider([error, okResponse]);
  const { sleep, delays } = recordingSleep();
  const retrying = new RetryingModelProvider(provider, { maxAttempts: 1, baseDelayMs: 10, sleep });

  await assert.rejects(retrying.generate(messages, tools, instruction), (e) => e === error);
  assert.equal(calls.length, 1);
  assert.deepEqual(delays, []);
});