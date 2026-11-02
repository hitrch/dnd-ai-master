import {createModel, createSampleState} from "../setup";
import {GameStateService} from "../storage/gameStateService";
import {Master} from "../master/master";
import { createInterface } from "node:readline/promises"
import { stdin, stdout } from "node:process"



const rl = createInterface({ input: stdin, output: stdout })
const store = new GameStateService()
const roomId = await store.createRoom(createSampleState())
const isLogging = process.argv.includes("--debug")
const master = new Master(store, roomId, createModel({ logging: isLogging }))
const room = await store.getRoomById(roomId)
rl.setPrompt("> ")

console.log(room?.location)
console.log("/state for state, /exit to exit, anything else to send to the model")
rl.prompt()
for await (const line of rl) {
  const trimmedLine = line.trim()
  if(trimmedLine === "/exit") break
  else if(trimmedLine === "/state") console.dir(await store.getRoomById(roomId), {depth: null})
  else if(trimmedLine) {
    try {
      const response = await master.handleMessage(trimmedLine)
      console.log(response)
    } catch (e) {
      console.error(e instanceof Error ? e.message : String(e))
    }
  }
  rl.prompt()
}
rl.close()
console.log("bye")
