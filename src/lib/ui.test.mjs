import assert from "node:assert/strict";
import { test } from "node:test";
import { ApiError, api } from "./api.ts";
import { responsiveImage } from "./images.ts";
import { changedQuantity, quantityStep, validQuantity } from "./quantity.ts";
import { consumerDestination, consumerUrl, farmerDestination, farmerUrl } from "./workspace.ts";

test("farmer notification destinations retain workspace context and enquiry deep links", () => {
  assert.equal(farmerDestination("/?view=enquiries&enquiry=abc"), "/?view=farm&section=enquiries&enquiry=abc");
  assert.equal(farmerDestination("/?view=farm"), farmerUrl("stock"));
  assert.equal(farmerDestination(farmerUrl("transfers", { batch: "12" })), farmerUrl("transfers", { batch: "12" }));
  assert.equal(farmerDestination("/?view=requests"), farmerUrl("requests"));
  assert.equal(farmerDestination("/?view=cart"), "/?view=cart");
  assert.equal(farmerDestination("https://example.com/?view=enquiries"), "https://example.com/?view=enquiries");
  assert.equal(farmerUrl("stock", { q: "", page: "2" }), "/?view=farm&section=stock&page=2");
});

test("consumer deep links retain their records without redirecting shopping into the workspace", () => {
  assert.equal(consumerDestination("/?view=enquiries&enquiry=abc"), consumerUrl("enquiries", { enquiry: "abc" }));
  assert.equal(consumerDestination("/?view=requests&request=24"), consumerUrl("requests", { request: "24" }));
  assert.equal(consumerDestination(consumerUrl("requests", { request: "24", offer: "3" })), consumerUrl("requests", { request: "24", offer: "3" }));
  assert.equal(consumerDestination("/?view=notifications"), consumerUrl("notifications"));
  assert.equal(consumerDestination("/?view=orders&enquiry=abc"), consumerUrl("enquiries", { enquiry: "abc" }));
  assert.equal(consumerDestination("/?view=cart"), "/?view=cart");
  assert.equal(consumerDestination("/?view=product&id=12"), "/?view=product&id=12");
  assert.equal(consumerDestination("https://example.com/?view=requests"), "https://example.com/?view=requests");
});

test("whole-animal controls reject fractions without changing divisible units", () => {
  assert.equal(quantityStep("head"), 1);
  assert.equal(quantityStep("kg"), 0.01);
  assert.equal(validQuantity("head", 0.5), false);
  assert.equal(validQuantity("head", 1), true);
  assert.equal(validQuantity("kg", 0.5), true);
  assert.equal(changedQuantity("head", 0.5, 1, 10), 1);
  assert.equal(changedQuantity("head", 1.5, -1, 10), 1);
  assert.equal(changedQuantity("head", 2, 1, 2.5), 2);
  assert.equal(changedQuantity("kg", 0.2, 0.1, 1), 0.3);
});

test("API validation retains individual fields without treating general errors as fields", () => {
  const error = new ApiError(400, { username: ["Already used."], quantity: ["Too much."], detail: "Check your details.", non_field_errors: ["Invalid combination."] });
  assert.deepEqual(error.fields, { username: "Already used.", quantity: "Too much." });
  assert.match(error.message, /Invalid combination/);
  assert.deepEqual(new ApiError(503, { detail: "Unavailable." }).fields, {});
});

test("responsive sources preserve crop settings and leave arbitrary image providers untouched", () => {
  const result = responsiveImage("https://images.unsplash.com/photo-example?fit=crop&w=800", "50vw");
  assert.equal(result.sizes, "50vw");
  const sources = result.srcSet.split(", ");
  assert.equal(sources.length, 6);
  assert.match(sources[0], /fit=crop.*w=160.*160w$/);
  assert.match(sources.at(-1), /w=1200.*1200w$/);
  assert.deepEqual(responsiveImage("https://farm.example/photo.jpg", "50vw"), {});
  assert.deepEqual(responsiveImage("/icon.svg", "50vw"), {});
});

test("concurrent catalog reads share a request, failed reads can retry, and mutations are never shared", async () => {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, method: options.method });
    await new Promise((resolve) => setTimeout(resolve, 5));
    return new Response(JSON.stringify(calls.length === 1 ? { detail: "Try again." } : []), { status: calls.length === 1 ? 503 : 200 });
  };
  try {
    const failed = await Promise.allSettled([api("listings/"), api("listings/")]);
    assert.ok(failed.every((result) => result.status === "rejected"));
    assert.equal(calls.length, 1);
    await api("listings/");
    assert.equal(calls.length, 2);
    await Promise.all([api("listings/", "POST", {}), api("listings/", "POST", {})]);
    assert.equal(calls.length, 4);
  } finally { globalThis.fetch = original; }
});

test("a mutation prevents reuse of an older in-flight catalog response", async () => {
  const original = globalThis.fetch;
  const reads = [];
  globalThis.fetch = (_url, options) => options.method === "GET"
    ? new Promise((resolve) => reads.push(resolve))
    : Promise.resolve(new Response("{}", { status: 200 }));
  try {
    const before = api("listings/");
    await api("checkout/", "POST", {});
    const after = api("listings/");
    assert.equal(reads.length, 2);
    reads[0](new Response('["old"]'));
    assert.deepEqual(await before, ["old"]);
    const shared = api("listings/");
    assert.equal(reads.length, 2);
    reads[1](new Response('["new"]'));
    assert.deepEqual(await after, ["new"]);
    assert.deepEqual(await shared, ["new"]);
  } finally { globalThis.fetch = original; }
});
