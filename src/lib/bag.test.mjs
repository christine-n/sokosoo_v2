import assert from "node:assert/strict";
import test from "node:test";
import { groupBag, restoreBag } from "./bag.ts";

const listing = (id, overrides = {}) => ({
  id, farmer: 1, farm_name: "Test farm", farmer_name: "Grower",
  channel: "direct", hub: null, hub_name: null, location: "Kiambu",
  price: "90.50", available: "4", ...overrides,
});

test("bag restoration refreshes listings, caps stock and reports unavailable items", () => {
  const current = listing(1, { price: "95", available: "2.5" });
  const restored = restoreBag(JSON.stringify([
    { listingId: 1, quantity: 3 }, { listingId: 2, quantity: 1 },
  ]), [current]);
  assert.deepEqual(restored, { items: [{ listing: current, quantity: 2.5 }], adjusted: true });
  assert.deepEqual(restoreBag(null, [current]), { items: [], adjusted: false });
});

test("bag restoration rejects corrupt, duplicate and invalid quantities", () => {
  for (const value of ["broken", "{}", '[{"listingId":1,"quantity":-1}]',
    '[{"listingId":1,"quantity":null}]', '[{"listingId":1,"quantity":1},{"listingId":1,"quantity":2}]']) {
    assert.throws(() => restoreBag(value, [listing(1)]));
  }
});

test("checkout groups match the server's farmer, channel and hub origin", () => {
  const items = [
    { listing: listing(1), quantity: 1.5 },
    { listing: listing(2, { price: "10" }), quantity: 2 },
    { listing: listing(3, { channel: "hub", hub: 7 }), quantity: 1 },
    { listing: listing(4, { channel: "hub", hub: 8 }), quantity: 1 },
    { listing: listing(5, { farmer: 2 }), quantity: 1 },
  ];
  const groups = groupBag(items);
  assert.equal(groups.length, 4);
  assert.deepEqual(groups[0].items, items.slice(0, 2));
  assert.equal(groups[0].total, 155.75);
  assert.deepEqual(groups.flatMap((group) => group.items), items);
});
