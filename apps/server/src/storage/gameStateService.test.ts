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

// --- actions (transaction: start -> commit | cancel) ---

const damaged = () => {
  const s = makeState();
  s.enemies[0].hp = 3;
  return s;
};

test("start returns a draft equal to the current state", async () => {
  const service = new GameStateService();
  const id = await service.createRoom(makeState());
  assert.deepEqual(await service.startAction(id), makeState());
});

test("mutating the draft does not change the stored state", async () => {
  const service = new GameStateService();
  const id = await service.createRoom(makeState());
  const draft = await service.startAction(id);
  draft.enemies[0].hp = 0;
  assert.deepEqual(await service.getRoomById(id), makeState());
});

test("start in an unknown room is rejected", async () => {
  const service = new GameStateService();
  await assert.rejects(service.startAction("missing"), /not found/);
});

test("second start while an action is active is rejected", async () => {
  const service = new GameStateService();
  const id = await service.createRoom(makeState());
  await service.startAction(id);
  await assert.rejects(service.startAction(id), /active action/);
});

test("an active action in one room does not block another room", async () => {
  const service = new GameStateService();
  const a = await service.createRoom(makeState());
  const b = await service.createRoom(makeState());
  await service.startAction(a);
  await assert.doesNotReject(service.startAction(b));
});

test("commit stores the new state", async () => {
  const service = new GameStateService();
  const id = await service.createRoom(makeState());
  await service.startAction(id);
  await service.commitAction(id, damaged());
  assert.deepEqual(await service.getRoomById(id), damaged());
});

test("commit releases the lock: a new action can start", async () => {
  const service = new GameStateService();
  const id = await service.createRoom(makeState());
  await service.startAction(id);
  await service.commitAction(id, damaged());
  assert.deepEqual(await service.startAction(id), damaged());
});

test("mutating the committed object afterwards does not change the stored state", async () => {
  const service = new GameStateService();
  const id = await service.createRoom(makeState());
  await service.startAction(id);
  const next = damaged();
  await service.commitAction(id, next);
  next.enemies[0].hp = 0;
  assert.deepEqual(await service.getRoomById(id), damaged());
});

test("cancel keeps the previous state and releases the lock", async () => {
  const service = new GameStateService();
  const id = await service.createRoom(makeState());
  const draft = await service.startAction(id);
  draft.enemies[0].hp = 0;
  await service.cancelAction(id);
  assert.deepEqual(await service.getRoomById(id), makeState());
  assert.deepEqual(await service.startAction(id), makeState());
});

test("reading during an action returns the last committed state", async () => {
  const service = new GameStateService();
  const id = await service.createRoom(makeState());
  await service.startAction(id);
  assert.deepEqual(await service.getRoomById(id), makeState());
});

test("commit without an active action is rejected and changes nothing", async () => {
  const service = new GameStateService();
  const id = await service.createRoom(makeState());
  await assert.rejects(service.commitAction(id, damaged()), /no active action/);
  assert.deepEqual(await service.getRoomById(id), makeState());
});

test("cancel without an active action is rejected", async () => {
  const service = new GameStateService();
  const id = await service.createRoom(makeState());
  await assert.rejects(service.cancelAction(id), /no active action/);
});

test("committing the same action twice is rejected", async () => {
  const service = new GameStateService();
  const id = await service.createRoom(makeState());
  await service.startAction(id);
  await service.commitAction(id, damaged());
  await assert.rejects(service.commitAction(id, makeState()), /no active action/);
  assert.deepEqual(await service.getRoomById(id), damaged());
});

test("commit after the room was deleted is rejected and does not resurrect it", async () => {
  const service = new GameStateService();
  const id = await service.createRoom(makeState());
  await service.startAction(id);
  await service.deleteRoomById(id);
  await assert.rejects(service.commitAction(id, damaged()), /not found/);
  assert.equal(await service.getRoomById(id), undefined);
});

test("cancel after the room was deleted is rejected and does not resurrect it", async () => {
  const service = new GameStateService();
  const id = await service.createRoom(makeState());
  await service.startAction(id);
  await service.deleteRoomById(id);
  await assert.rejects(service.cancelAction(id), /not found/);
  assert.equal(await service.getRoomById(id), undefined);
});
