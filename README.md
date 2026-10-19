# AI Dungeon Master
 
A web app where players play a D&D-style tabletop RPG together, with an AI acting as the game master. A personal project built for learning.
 
## Overview
 
Players join a shared room, create characters and describe what they do. The AI game master narrates the world, plays NPCs and enemies, and reacts to the players' choices. Dice rolls, checks, damage and hit points are handled by a rules engine rather than improvised by the model, so the game stays fair and consistent.
 
## How it works
 
Language models are good storytellers but unreliable referees: they miscount hit points, forget inventory and tend to go easy on players. The project splits the work accordingly:
 
- **Code owns the game state and the rules.** A deterministic rules engine computes rolls, skill checks, damage and HP.
- **The model narrates.** It changes the game only by calling tools (for example `roll_check` and `apply_damage`) and describes the results the engine returns.
- **Every tool call is validated.** Arguments coming from the model are checked against schemas shared by the whole codebase.
- **The model always sees the current state.** The up-to-date game state is injected into each request, so the narration stays consistent with the numbers.
- **Long games stay coherent.** Older history is compressed into summaries and a structured "world book" (NPCs, locations, quests), so the master remembers what matters.
## Tech stack
 
- TypeScript and Node.js (ES modules)
- npm workspaces (monorepo): shared schemas and types, backend, web client
- [Zod](https://zod.dev) for schemas and validation
- Google Gemini API via [`@google/genai`](https://www.npmjs.com/package/@google/genai) (function calling)
- React for the web client, WebSockets for real-time rooms
## Getting started
 
### Prerequisites
 
- Node.js 20.6 or newer (the `--env-file` flag is required)
- A Gemini API key (for example from [Google AI Studio](https://aistudio.google.com))
### Setup
 
```bash
npm install
```
 
Create a `.env` file in the repository root (it is git-ignored):
 
```
GEMINI_API_KEY=your_key_here
GEMINI_MODEL=your_model_name
```
 
Model availability on the free tier changes over time, so check which models your key can use and set `GEMINI_MODEL` accordingly.
 
### Run
 
```bash
npm run dev -w apps/server
```
 
### Test
 
```bash
npm test -w apps/server
```
 
## Disclaimer
 
This is an unofficial hobby project and is not affiliated with or endorsed by Wizards of the Coast. The rules are intended to be based on the freely licensed D&D 5e System Reference Document 5.1 (CC BY 4.0); the setting and characters are original.
 
## License
 
No license has been chosen yet.
