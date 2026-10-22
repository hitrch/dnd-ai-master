import { test } from "node:test";
import assert from "node:assert/strict";
import { GameStateSchema } from "@dnd/shared";
import { GameStateService } from "./gameStateService";

const makeState = () =>
  GameStateSchema.parse({
    location: "Подножие башни",
    players: [
      { id: "p1", name: "Арвен", hp: 12, maxHp: 12, skills: { stealth: 5, athletics: 1 } },
    ],
    enemies: [{ id: "e1", name: "Гоблин-часовой", hp: 7, maxHp: 7 }],
  });

test("created room can be read back with an equal state", async () => {
  const service = new GameStateService();
  const id = await service.createRoom(makeState());
  assert.deepEqual(await service.getRoomById(id), makeState());
});

test("each created room gets a unique id", async () => {
  const service = new GameStateService();
  const a = await service.createRoom(makeState());
  const b = await service.createRoom(makeState());
  assert.notEqual(a, b);
});

test("mutating the read copy does not change the stored state", async () => {
  const service = new GameStateService();
  const id = await service.createRoom(makeState());

  const copy = await service.getRoomById(id);
  assert.ok(copy);
  copy.players[0].hp = 0;
  copy.players[0].skills.stealth = 99;

  assert.deepEqual(await service.getRoomById(id), makeState());
});

test("mutating the input after creation does not change the stored state", async () => {
  const service = new GameStateService();
  const input = makeState();
  const id = await service.createRoom(input);

  input.players[0].hp = 0;
  input.enemies.pop();

  assert.deepEqual(await service.getRoomById(id), makeState());
});

test("reading an unknown room returns undefined", async () => {
  const service = new GameStateService();
  assert.equal(await service.getRoomById("missing"), undefined);
});

test("deleting an existing room returns true and the room is gone", async () => {
  const service = new GameStateService();
  const id = await service.createRoom(makeState());
  assert.equal(await service.deleteRoomById(id), true);
  assert.equal(await service.getRoomById(id), undefined);
});

test("deleting an unknown room returns false", async () => {
  const service = new GameStateService();
  assert.equal(await service.deleteRoomById("missing"), false);
});

test("deleting one room leaves the others intact", async () => {
  const service = new GameStateService();
  const a = await service.createRoom(makeState());
  const b = await service.createRoom(makeState());
  await service.deleteRoomById(a);
  assert.deepEqual(await service.getRoomById(b), makeState());
});
