import { GameStateSchema, RollCheckArgsSchema } from "@dnd/shared";
import {Master} from "./master";

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
console.dir(state, { depth: null });

// "flying" is not in the skill list, the schema must reject the call
const bad = RollCheckArgsSchema.safeParse({ characterId: "p1", skill: "flying", dc: 10 });
console.log("flying accepted:", bad.success);

const good = RollCheckArgsSchema.safeParse({ characterId: "p1", skill: "stealth", dc: 12 });
console.log("stealth accepted:", good.success);