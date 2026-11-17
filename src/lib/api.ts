export type User = { id: number; name: string; username: string; role: "consumer" | "farmer" | "manager" | "driver"; farm_name: string };
export type Hub = { id: number; name: string; location: string; latitude: number; longitude: number };
export type Listing = {
  id: number; farmer: number; farmer_name: string; farm_name: string; name: string;
  category: string; description: string; price: string; quantity: string; available: string;
  unit: string; channel: "direct" | "hub"; hub: number | null; hub_name: string | null;
  location: string; latitude: number; longitude: number; harvest_date: string;
  image: string; received: boolean; distance?: number;
};
export type Bid = { id: number; farmer_name: string; farm_name: string; listing: number; listing_name: string; price: string; message: string };
export type ProduceRequest = {
  id: number; consumer_name: string; name: string; quantity: string; unit: string;
  budget: string; location: string; notes: string; deadline: string; status: string;
  bids: Bid[]; is_owner: boolean;
};
export type Order = {
  id: string; address: string; total: string; payment_method: string; payment_status: string;
  status: string; created_at: string; expires_at: string;
  items: { id: number; name: string; quantity: string; unit: string; price: string; image: string; farmer_name: string; location: string }[];
  events: { status: string; created_at: string }[];
  location: { latitude: number; longitude: number; accuracy: number; recorded_at: string } | null;
  review?: { produce_rating: number; delivery_rating: number; comment: string };
};
export type CartItem = { listing: Listing; quantity: number };

function errorText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(errorText).join(" ");
  if (value && typeof value === "object") return Object.entries(value).map(([key, message]) => `${key === "detail" || key === "non_field_errors" ? "" : `${key}: `}${errorText(message)}`).join(" ");
  return "The request could not be completed.";
}

export class ApiError extends Error {
  readonly fields: Record<string, string>;
  readonly status: number;
  constructor(status: number, body: unknown) {
    super(errorText(body));
    this.name = "ApiError";
    this.status = status;
    this.fields = body && typeof body === "object" && !Array.isArray(body)
      ? Object.fromEntries(Object.entries(body).filter(([key]) => key !== "detail" && key !== "non_field_errors").map(([key, value]) => [key, errorText(value)]))
      : {};
  }
}

const pendingReads = new Map<string, Promise<unknown>>();

export async function api<T>(path: string, method = "GET", data?: unknown): Promise<T> {
  if (method === "GET" && /^(listings|hubs)\//.test(path)) {
    const pending = pendingReads.get(path);
    if (pending) return pending as Promise<T>;
    const request = send<T>(path, method, data);
    pendingReads.set(path, request);
    try { return await request; } finally { if (pendingReads.get(path) === request) pendingReads.delete(path); }
  }
  if (method !== "GET") pendingReads.clear();
  return send<T>(path, method, data);
}

async function send<T>(path: string, method: string, data?: unknown): Promise<T> {
  const csrf = typeof document === "undefined" ? "" : document.cookie.split("; ").find((cookie) => cookie.startsWith("sokosoo_csrftoken="))?.split("=")[1];
  let response: Response;
  try {
    response = await fetch(`/api/${path}`, {
      method, credentials: "same-origin", cache: "no-store",
      headers: { "Content-Type": "application/json", ...(csrf ? { "X-CSRFToken": csrf } : {}) },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    });
  } catch {
    throw new Error("Cannot reach SokoSoo. Check your connection and that the Django server is running.");
  }
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`The server returned an unexpected response (${response.status}). Check the Django server.`);
  }
  if (!response.ok) throw new ApiError(response.status, body);
  return body as T;
}

export const money = (value: string | number) => `KSh ${Number(value).toLocaleString("en-KE", { maximumFractionDigits: 2 })}`;
export const label = (value: string) => value.replaceAll("_", " ");
