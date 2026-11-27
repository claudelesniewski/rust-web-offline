import assert from "node:assert/strict";
import { test } from "node:test";
import { split } from "../../web/layout.js";

test("a handle stays where it is dragged, between the minimums", () => {
  assert.equal(split(300, 1000, 100), 300);
  assert.equal(split(100, 1000, 100), 100);
  assert.equal(split(900, 1000, 100), 900);
});

test("a handle dragged too far stops at the minimum from either end", () => {
  assert.equal(split(20, 1000, 100), 100);
  assert.equal(split(-50, 1000, 100), 100);
  assert.equal(split(990, 1000, 100), 900);
  assert.equal(split(5000, 1000, 100), 900);
});

test("with too little room for both minimums, a handle goes in the middle", () => {
  assert.equal(split(10, 150, 100), 75);
  assert.equal(split(140, 150, 100), 75);
});
