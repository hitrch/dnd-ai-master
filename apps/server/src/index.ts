import { GameStateSchema } from "@dnd/shared";
import { GameStateService } from "./storage/gameStateService";
import { GeminiProvider } from "./model/gemini/geminiProvider";
import { RetryingModelProvider } from "./model/retryingModelProvider";
import { ModelError } from "./model/modelError";
import { Master } from "./master/master";
import type { ModelProvider } from "./model/types";

// Manual check: one real Gemini request through Master, the model should call roll_check
// with the character id taken from the game state in the system instruction

const apiKey = process.env.GEMINI_API_KEY;
const modelName = process.env.GEMINI_MODEL;
// Gemini itself answers 504 after ~19 s, so a longer client timeout buys nothing.
// Worst case per model call: 3 attempts x 15 s + 1 s + 2 s of pauses ~ 48 s
const timeoutMs = 15_000;
const retryOptions = { maxAttempts: 3, baseDelayMs: 1000 };
if (!apiKey) throw new Error("GEMINI_API_KEY is not set");
if (!modelName) throw new Error("GEMINI_MODEL is not set");

const state = GameStateSchema.parse({
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

// Logging sits inside the retries, so every attempt is printed, not only the final result
const gemini = new GeminiProvider(apiKey, modelName, timeoutMs);
const model = new RetryingModelProvider(withLogging(gemini), retryOptions);

const store = new GameStateService();
const roomId = await store.createRoom(state);
const master = new Master(store, roomId, model);

const answer = await master.handleMessage("Крадусь мимо гоблина-часового к двери башни.");
console.log("[answer]", answer);
console.dir(await store.getRoomById(roomId), { depth: null });
