import { test } from "node:test";
import assert from "node:assert/strict";
import { isPlainObject } from "./utils";

test("isPlainObject accepts plain objects, including an empty one", () => {
  assert.equal(isPlainObject({ characterId: "p1", dc: 10 }), true);
  assert.equal(isPlainObject({}), true);
});

test("isPlainObject rejects null and arrays, although typeof says object", () => {
  assert.equal(isPlainObject(null), false);
  assert.equal(isPlainObject([]), false);
  assert.equal(isPlainObject([{ characterId: "p1" }]), false);
});

test("isPlainObject rejects primitives and undefined", () => {
  assert.equal(isPlainObject(42), false);
  assert.equal(isPlainObject("{}"), false);
  assert.equal(isPlainObject(true), false);
  assert.equal(isPlainObject(undefined), false);
});

test("isPlainObject passes only the object results of JSON.parse", () => {
  assert.equal(isPlainObject(JSON.parse('{"amount":3}')), true);
  assert.equal(isPlainObject(JSON.parse("null")), false);
  assert.equal(isPlainObject(JSON.parse("[1,2]")), false);
  assert.equal(isPlainObject(JSON.parse("7")), false);
});