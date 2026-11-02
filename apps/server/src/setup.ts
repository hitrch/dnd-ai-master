import { GameStateSchema } from "@dnd/shared";
import type { GameState } from "@dnd/shared";
import { GeminiProvider } from "./model/gemini/geminiProvider";
import { GroqProvider } from "./model/groq/groqProvider";
import { RetryingModelProvider } from "./model/retryingModelProvider";
import { ModelError } from "./model/modelError";
import type { ModelProvider } from "./model/types";

// Shared wiring for the entry points (index.ts sandbox, console client): which model to use and a starting game

// Gemini itself answers 504 after ~19 s, so a longer client timeout buys nothing.
// Worst case per model call: 3 attempts x 15 s + 1 s + 2 s of pauses ~ 48 s
const timeoutMs = 15_000;
const retryOptions = { maxAttempts: 3, baseDelayMs: 1000 };

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

// MODEL_PROVIDER picks the model behind Master: "groq" (default) or "gemini"
function createProvider(): ModelProvider {
  const provider = process.env.MODEL_PROVIDER ?? "groq";
  switch (provider) {
    case "groq":
      return new GroqProvider(requireEnv("GROQ_API_KEY"), requireEnv("GROQ_MODEL"), timeoutMs);
    case "gemini":
      return new GeminiProvider(requireEnv("GEMINI_API_KEY"), requireEnv("GEMINI_MODEL"), timeoutMs);
    default:
      throw new Error(`Unknown MODEL_PROVIDER: ${provider}`);
  }
}

// Wraps a provider to print what the model really returns (or why it failed), so tool calls and retries are visible
function withLogging(provider: ModelProvider): ModelProvider {
  return {
    async generate(messages, tools, systemInstruction) {
      try {
        const response = await provider.generate(messages, tools, systemInstruction);
        console.log("[model]", JSON.stringify(response));
        return response;
      } catch (error) {
        const retryable = error instanceof ModelError ? error.isRetryable : false;
        console.log("[model error]", `retryable=${retryable}`, error instanceof Error ? error.message : error);
        throw error;
      }
    },
  };
}

// The model for Master: provider from the environment with retries.
// With logging, every attempt is printed: logging sits inside the retries, not around them
export function createModel(options: { logging: boolean }): ModelProvider {
  const provider = createProvider();
  return new RetryingModelProvider(options.logging ? withLogging(provider) : provider, retryOptions);
}

// A small starting scene for manual checks and trial games
export function createSampleState(): GameState {
  return GameStateSchema.parse({
    location: "Подножие башни",
    players: [
      {
        id: "p1",
        name: "Арвен",
        hp: 12,
        maxHp: 12,
        skills: { stealth: 5, athletics: 1, persuasion: 2, perception: 3 },
      },
    ],
    enemies: [{ id: "e1", name: "Гоблин-часовой", hp: 7, maxHp: 7 }],
  });
}