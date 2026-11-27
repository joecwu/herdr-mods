import { test } from "node:test";
import assert from "node:assert/strict";
import { machineOf, placeKey, addressOf } from "../mods/decisions/places.js";

test("machineOf reads the machine prefix, and null for this machine", () => {
  assert.equal(machineOf("m5/p3"), "m5");
  assert.equal(machineOf("p3"), null);
  assert.equal(machineOf(null), null);
});

test("placeKey tells the same path on two machines apart", () => {
  assert.equal(placeKey(null, "/repo"), "/repo");
  assert.equal(placeKey("m5", "/repo"), "m5:/repo");
  assert.notEqual(placeKey("m5", "/repo"), placeKey("m6", "/repo"));
});

test("addressOf prefixes a remote session's bare terminal id with its machine", () => {
  assert.equal(addressOf("m5", "t3"), "m5/t3");
  assert.equal(addressOf("m5", "m5/t3"), "m5/t3");
  assert.equal(addressOf(null, "t3"), "t3");
  assert.equal(addressOf("m5", ""), "");
});
