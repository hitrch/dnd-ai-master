import { GameStateSchema } from "@dnd/shared";
import { GameStateService } from "./storage/gameStateService";
import { GeminiProvider } from "./gemini/geminiProvider";
import { Master } from "./master/master";
import type { ModelProvider } from "./types";

// Manual check: one real Gemini request through Master, the model should call roll_check
// with the character id taken from the game state in the system instruction

const apiKey = process.env.GEMINI_API_KEY;
const modelName = process.env.GEMINI_MODEL;
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

// Wraps a provider to print what the model really returns, so tool calls are visible
function withLogging(provider: ModelProvider): ModelProvider {
  return {
    async generate(messages, tools, systemInstruction) {
      const response = await provider.generate(messages, tools, systemInstruction);
      console.log("[model]", JSON.stringify(response));
      return response;
    },
  };
}

const store = new GameStateService();
const roomId = await store.createRoom(state);
const master = new Master(store, roomId, withLogging(new GeminiProvider(apiKey, modelName)));

const answer = await master.handleMessage("Крадусь мимо гоблина-часового к двери башни.");
console.log("[answer]", answer);
console.dir(await store.getRoomById(roomId), { depth: null });
