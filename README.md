# AI Dungeon Master

A web app where players play a D&D-style tabletop RPG together, with an AI acting as the game master. A personal, non-commercial project built for learning.

## Overview

Players describe what their characters do. The AI game master narrates the world, plays NPCs and enemies, and reacts to the players' choices. Dice rolls, checks, attacks, damage, hit points, turn order and inventory are handled by a rules engine rather than improvised by the model, so the game stays fair and consistent.

## How it works

Language models are good storytellers but unreliable referees: they miscount hit points, forget inventory and tend to go easy on players. The project splits the work accordingly:

- **Code owns the game state and the rules.** The rules engine is a set of pure functions; randomness is passed in, so every rule is deterministic under test.
- **The model narrates.** It changes the game only by calling tools (for example `attack` or `give_items`) and describes the results the engine returns. Numbers the player names ("I rolled a 20") are ignored.
- **Every tool call is validated.** Arguments from the model are checked against Zod schemas shared by the whole codebase; the same schemas produce the JSON Schema the model sees.
- **Refusals go back to the model.** A rule violation (not your turn, no such item) returns to the model as a tool result, so it can correct itself instead of the action failing.
- **One player message is one transaction.** The model may call tools over several rounds; the state is committed only when the whole action succeeds and rolled back otherwise.
- **The model always sees the current state.** The game state is injected into every request, so the narration stays consistent with the numbers.
- **Long games stay coherent.** Older turns are compacted, then folded into a running summary, and the model keeps a "world book" of short facts (NPCs, places, quests, deals).
- **The model provider is replaceable.** The master depends on a small `generate(messages, tools, instruction)` interface; Groq and Gemini are implemented, with retries and rate-limit handling in a separate decorator.

## What the master can do

| Area | Tools |
|---|---|
| Checks | `roll_check` (d20 + skill vs DC) |
| Combat | `start_combat` (initiative), `attack`, `end_turn`, `end_combat`; turns pass and fights end automatically |
| Damage and healing | `apply_damage` (traps, falls), `apply_heal`, `apply_healing_potion` |
| Dying | `death_save`; in combat death saves are rolled by the engine when the turn passes |
| Items and coins | `give_items`, `transfer_items` (looting, trading), `delete_items` |
| World | `spawn_enemies`, `change_location`, `update_world_book` |

## Status

Work in progress. The single-player core is done and playable from the console; the web server, database, multiplayer rooms and the web client are next.

| Part | State |
|---|---|
| Rules engine | done: checks, weapon attacks with crits, damage, healing, death saves, initiative and turns, inventory, spawning enemies, locations |
| Model integration | done: Groq (default) and Gemini, tools, master prompt, retries and rate limits |
| Memory | done: history compaction, summary, world book |
| Console client | done |
| Server (NestJS), PostgreSQL + TypeORM, event log | next |
| Web client (React), streaming | planned |
| Multiplayer rooms (WebSocket), hidden master notes | planned |
| Moderation, rate limits, deployment | planned |

Known issues in the master's behaviour: it sometimes states hit points aloud, cannot handle fleeing from combat yet, and does not clean up outdated world book notes.

## Tech stack

- TypeScript and Node.js (ES modules), npm workspaces
- [Zod](https://zod.dev) for schemas, validation and JSON Schema for tools
- [Groq](https://console.groq.com) via `groq-sdk` (default model `openai/gpt-oss-120b`) and Google Gemini via `@google/genai`
- Built-in `node:test` runner, Prettier
- Planned: NestJS, PostgreSQL with TypeORM, React (Vite), WebSockets

## Project structure

```
packages/shared/src     schemas and types shared by server and client: game state, tool arguments, events
apps/server/src
  engine/               rules engine (pure functions)
  master/               the master: action loop, tool execution, prompt and tool descriptions
  model/                model provider interface, errors, retries; groq/ and gemini/ implementations
  storage/              game state storage (in memory for now)
  cli/                  console client
  setup.ts              wiring: model provider from environment, sample starting scene
```

## Getting started

### Prerequisites

- Node.js 22 or newer
- A Groq API key ([console.groq.com](https://console.groq.com)) or a Gemini API key ([Google AI Studio](https://aistudio.google.com))

### Setup

```bash
npm install
```

Create a `.env` file in the repository root (it is git-ignored):

```
MODEL_PROVIDER=groq
GROQ_API_KEY=your_key_here
GROQ_MODEL=openai/gpt-oss-120b

# or, with MODEL_PROVIDER=gemini
GEMINI_API_KEY=your_key_here
GEMINI_MODEL=your_model_name
```

Free tiers have per-minute and per-day token limits, and model availability changes over time; check what your key can use.

### Play in the console

```bash
npm run play -w @dnd/server
```

Type what your character does. `/state` prints the game state, `/exit` quits. Add `-- --debug` to log every model request (in PowerShell use `npm.cmd`, since `npm.ps1` drops the `--`).

### Test and format

```bash
npm test -w @dnd/server
npx tsc --noEmit -p apps/server
npm run format:check
```

## Disclaimer

This is an unofficial hobby project and is not affiliated with or endorsed by Wizards of the Coast. The rules are based on the freely licensed D&D 5e System Reference Document 5.1 (CC BY 4.0); the setting and characters are original.

## License

No license has been chosen yet.
