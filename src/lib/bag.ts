import type { CartItem, Listing } from "./api";

export function restoreBag(serialized: string | null, catalog: Listing[]) {
  if (serialized === null) return { items: [] as CartItem[], adjusted: false };
  const entries: unknown = JSON.parse(serialized);
  if (!Array.isArray(entries)) throw new Error("The saved bag is not a list.");
  const items: CartItem[] = [];
  const seen = new Set<number>();
  let adjusted = false;
  for (const entry of entries) {
    if (!entry || typeof entry !== "object"
      || !("listingId" in entry) || typeof entry.listingId !== "number" || !Number.isSafeInteger(entry.listingId)
      || !("quantity" in entry) || typeof entry.quantity !== "number" || !Number.isFinite(entry.quantity)
      || entry.quantity <= 0 || seen.has(entry.listingId)) {
      throw new Error("The saved bag contains an invalid item.");
    }
    seen.add(entry.listingId);
    const listing = catalog.find((item) => item.id === entry.listingId);
    if (!listing || Number(listing.available) <= 0) { adjusted = true; continue; }
    const quantity = Math.min(Math.round(entry.quantity * 100) / 100, Number(listing.available));
    if (quantity <= 0) { adjusted = true; continue; }
    if (quantity !== entry.quantity) adjusted = true;
    items.push({ listing, quantity });
  }
  return { items, adjusted };
}

export function groupBag(items: CartItem[]) {
  const groups = new Map<string, { key: string; farmer: string; pickup: string; items: CartItem[]; total: number }>();
  for (const item of items) {
    const listing = item.listing;
    const key = `${listing.farmer}-${listing.channel}-${listing.hub ?? "farm"}`;
    let group = groups.get(key);
    if (!group) {
      group = {
        key, farmer: listing.farm_name || listing.farmer_name,
        pickup: listing.channel === "hub" ? listing.hub_name || listing.location : listing.location,
        items: [], total: 0,
      };
      groups.set(key, group);
    }
    group.items.push(item);
    group.total += Number(listing.price) * item.quantity;
  }
  return [...groups.values()];
}
