import { GameStateService } from "./storage/gameStateService.js"
import { Master } from "./master/master.js"
import { createModel, createSampleState, maxRounds } from "./setup.js"

// Manual check: one real model request through Master, the model should call roll_check
// with the character id taken from the game state in the system instruction

const store = new GameStateService()
const roomId = await store.createRoom(createSampleState())
const master = new Master(store, roomId, createModel({ logging: true }), Math.random, maxRounds)

const answer = await master.handleMessage("Крадусь мимо гоблина-часового к двери башни.")
console.log("[answer]", answer)
console.dir(await store.getRoomById(roomId), { depth: null })
