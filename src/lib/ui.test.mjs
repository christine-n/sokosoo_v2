import assert from "node:assert/strict";
import { test } from "node:test";
import { ApiError, api } from "./api.ts";
import { responsiveImage } from "./images.ts";

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
