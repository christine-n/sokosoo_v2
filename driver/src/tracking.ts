import * as Location from "expo-location";
import * as SecureStore from "expo-secure-store";
import * as TaskManager from "expo-task-manager";

export const TRACKING_TASK = "sokosoo-delivery-location";
const SESSION_KEY = "sokosoo-driver-session";
const LAST_ERROR = "sokosoo-tracking-error";

export type Session = { baseUrl: string; token: string; name: string };
type TrackingSession = Session & { orderId?: string };

export async function readSession(): Promise<TrackingSession | null> {
  const raw = await SecureStore.getItemAsync(SESSION_KEY);
  if (!raw) return null;
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== "object" || !("baseUrl" in value) || !("token" in value) || !("name" in value)
    || typeof value.baseUrl !== "string" || typeof value.token !== "string" || typeof value.name !== "string") {
    throw new Error("Stored session is invalid. Sign in again.");
  }
  return value as TrackingSession;
}

export async function saveSession(session: TrackingSession) {
  await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(session), {
    keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
  });
}

export async function driverApi<T>(session: Session, path: string, method = "GET", data?: unknown): Promise<T> {
  const response = await fetch(`${session.baseUrl}/api/${path}`, {
    method,
    headers: { Authorization: `Token ${session.token}`, "Content-Type": "application/json" },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  });
  if (response.status === 204) return undefined as T;
  const body = await response.json();
  if (!response.ok) throw new Error(typeof body.detail === "string" ? body.detail : JSON.stringify(body));
  return body as T;
}

TaskManager.defineTask<{ locations: Location.LocationObject[] }>(TRACKING_TASK, async ({ data, error }) => {
  try {
    if (error) throw new Error(error.message);
    const session = await readSession();
    if (!session?.orderId || !data?.locations.length) return;
    const location = data.locations[data.locations.length - 1];
    if (location.coords.accuracy === null) throw new Error("GPS accuracy is unavailable. Waiting for a reliable location fix.");
    await driverApi(session, `orders/${session.orderId}/tracking/`, "POST", {
      latitude: location.coords.latitude,
      longitude: location.coords.longitude,
      accuracy: location.coords.accuracy,
      recorded_at: new Date(location.timestamp).toISOString(),
    });
    await SecureStore.deleteItemAsync(LAST_ERROR);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Tracking update failed.";
    console.error("SokoSoo location upload:", message);
    await SecureStore.setItemAsync(LAST_ERROR, `${new Date().toISOString()} ${message}`, {
      keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
    });
  }
});

export async function startTracking(session: Session, orderId: string) {
  const foreground = await Location.requestForegroundPermissionsAsync();
  if (!foreground.granted) throw new Error("Allow location access to track this delivery.");
  const background = await Location.requestBackgroundPermissionsAsync();
  if (!background.granted) throw new Error("Allow background location in Settings so tracking continues during navigation.");
  if (!await Location.hasServicesEnabledAsync()) throw new Error("Turn on device location services first.");
  await stopTracking();
  await saveSession({ ...session, orderId });
  try {
    await Location.startLocationUpdatesAsync(TRACKING_TASK, {
      accuracy: Location.Accuracy.Balanced,
      timeInterval: 15000,
      distanceInterval: 20,
      pausesUpdatesAutomatically: false,
      showsBackgroundLocationIndicator: true,
      foregroundService: {
        notificationTitle: "SokoSoo delivery tracking",
        notificationBody: "Your location is shared during this active delivery.",
        notificationColor: "#5c7952",
      },
    });
  } catch (cause) {
    await saveSession(session);
    throw cause;
  }
}

export async function stopTracking() {
  if (await Location.hasStartedLocationUpdatesAsync(TRACKING_TASK)) {
    await Location.stopLocationUpdatesAsync(TRACKING_TASK);
  }
  const session = await readSession();
  if (session?.orderId) await saveSession({ baseUrl: session.baseUrl, token: session.token, name: session.name });
}

export async function trackingHealth() {
  return {
    active: await Location.hasStartedLocationUpdatesAsync(TRACKING_TASK),
    lastError: await SecureStore.getItemAsync(LAST_ERROR),
    orderId: (await readSession())?.orderId,
  };
}

export async function clearSession() {
  await stopTracking();
  await SecureStore.deleteItemAsync(SESSION_KEY);
  await SecureStore.deleteItemAsync(LAST_ERROR);
}
