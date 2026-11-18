import assert from "node:assert/strict";
import test from "node:test";
import { groupBag, resolveBag, restoreBag } from "./bag.ts";

const listing = (id, overrides = {}) => ({
  id, farmer: 1, farm_name: "Test farm", farmer_name: "Grower",
  channel: "direct", hub: null, hub_name: null, location: "Kiambu",
  price: "90.50", available: "4",
  available_until: "2099-01-01T00:00:00Z", ...overrides,
});

test("bag restoration refreshes listings without silently changing enquiry quantities", () => {
  const current = listing(1, { price: "95", available: "2.5" });
  const restored = restoreBag(JSON.stringify([
    { listingId: 1, quantity: 3 }, { listingId: 2, quantity: 1 },
  ]), [current], 1000);
  assert.deepEqual(restored, { items: [{ listing: current, quantity: 3, expiresAt: 86401000 }], adjusted: true });
  assert.deepEqual(restoreBag(null, [current]), { items: [], adjusted: false });
});

test("bag expiry is per item and does not restart when quantities change", () => {
  const result = restoreBag(JSON.stringify([
    { listingId: 1, quantity: 1, expiresAt: 999 },
    { listingId: 2, quantity: 2, expiresAt: 2000 },
  ]), [listing(1), listing(2)], 1000);
  assert.equal(result.adjusted, true);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].expiresAt, 2000);
});

test("bag entries expire earlier when the listing deadline is reached", () => {
  const current = listing(1, { available_until: new Date(1500).toISOString() });
  const saved = JSON.stringify([{ listingId: 1, quantity: 1, expiresAt: 2000 }]);
  assert.equal(restoreBag(saved, [current], 1000).items[0].expiresAt, 1500);
  assert.deepEqual(restoreBag(saved, [current], 1500), { items: [], adjusted: true });
});

test("bag restoration rejects corrupt, duplicate and invalid quantities", () => {
  for (const value of ["broken", "{}", '[{"listingId":1,"quantity":-1}]',
    '[{"listingId":1,"quantity":null}]', '[{"listingId":1,"quantity":1},{"listingId":1,"quantity":2}]']) {
    assert.throws(() => restoreBag(value, [listing(1)]));
  }
});

test("enquiry groups match the server's farmer, channel and hub origin", () => {
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

test("bag resolution looks up saved IDs independently and propagates network failures", async () => {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(url);
    return new Response(JSON.stringify([listing(501)]));
  };
  const saved = JSON.stringify([{ listingId: 501, quantity: 1, expiresAt: Date.now() + 10000 }]);
  try {
    assert.equal((await resolveBag(saved)).items[0].listing.id, 501);
    assert.deepEqual(calls, ["/api/listings/?ids=501"]);
    globalThis.fetch = async () => { throw new Error("Offline"); };
    await assert.rejects(resolveBag(saved), /Cannot reach SokoSoo/);
    await assert.rejects(resolveBag('[{"listingId":"invalid","quantity":1}]'), /invalid product/);
  } finally { globalThis.fetch = original; }
});
