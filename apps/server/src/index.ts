import { GameStateService } from "./storage/gameStateService";
import { Master } from "./master/master";
import { createModel, createSampleState } from "./setup";

// Manual check: one real model request through Master, the model should call roll_check
// with the character id taken from the game state in the system instruction

const store = new GameStateService();
const roomId = await store.createRoom(createSampleState());
const master = new Master(store, roomId, createModel({ logging: true }));

const answer = await master.handleMessage("Крадусь мимо гоблина-часового к двери башни.");
console.log("[answer]", answer);
console.dir(await store.getRoomById(roomId), { depth: null });