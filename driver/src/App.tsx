import { useEffect, useState } from "react";
import { Alert, Linking, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { clearSession, driverApi, readSession, saveSession, startTracking, stopTracking, trackingHealth, type Session } from "./tracking";

type Job = { id: string; address: string; status: string; payment_status: string; items: { name: string; quantity: string; unit: string; location: string }[] };

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [baseUrl, setBaseUrl] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [jobs, setJobs] = useState<Job[]>([]);
  const [busy, setBusy] = useState(false);
  const [health, setHealth] = useState<{ active: boolean; lastError: string | null; orderId?: string }>({ active: false, lastError: null });
  const [error, setError] = useState("");

  async function run(work: () => Promise<void>) {
    setBusy(true); setError("");
    try { await work(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "The action failed. Try again."); }
    finally { setBusy(false); }
  }
  async function refresh(current: Session) {
    const [data, status] = await Promise.all([driverApi<Job[]>(current, "orders/"), trackingHealth()]);
    setJobs(data.filter((job) => ["processing", "picked", "en_route"].includes(job.status)));
    if (status.orderId && !data.some((job) => job.id === status.orderId && ["picked", "en_route"].includes(job.status))) {
      await stopTracking();
      setHealth(await trackingHealth());
    } else setHealth(status);
  }
  useEffect(() => { void run(async () => { const stored = await readSession(); setSession(stored); if (stored) await refresh(stored); }); }, []);
  useEffect(() => {
    if (!session) return;
    const timer = setInterval(() => { void refresh(session).catch((cause: Error) => setError(cause.message)); }, 15000);
    return () => clearInterval(timer);
  }, [session]);

  return <View style={styles.screen}><StatusBar style="dark"/><ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
    <Text style={styles.brand}>SokoSoo<Text style={styles.light}> Driver</Text></Text>
    <Text style={styles.intro}>A good harvest deserves a good journey.</Text>
    {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
    {!session ? <>
      <Text style={styles.heading}>Ready for your next delivery?</Text>
      <Text style={styles.copy}>Use your assigned driver account. Your backend must be reachable over HTTPS from this device.</Text>
      <Text style={styles.label}>Platform URL</Text><TextInput style={styles.input} autoCapitalize="none" keyboardType="url" placeholder="https://your-sokosoo-domain" value={baseUrl} onChangeText={setBaseUrl}/>
      <Text style={styles.label}>Username</Text><TextInput style={styles.input} autoCapitalize="none" autoComplete="username" value={username} onChangeText={setUsername}/>
      <Text style={styles.label}>Password</Text><TextInput style={styles.input} secureTextEntry autoComplete="current-password" value={password} onChangeText={setPassword}/>
      <Pressable disabled={busy} style={styles.button} onPress={() => void run(async () => {
        const url = new URL(baseUrl.trim());
        if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || (url.pathname !== "/" && url.pathname !== "")) {
          throw new Error("Enter an HTTPS origin without a path or embedded credentials.");
        }
        const response = await fetch(`${url.origin}/api/driver-token/`, {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(JSON.stringify(data));
        const current: Session = { baseUrl: url.origin, token: data.token, name: data.user.name };
        await saveSession(current); setSession(current); setPassword(""); await refresh(current);
      })}><Text style={styles.buttonText}>{busy ? "Signing in…" : "Sign in"}</Text></Pressable>
    </> : <>
      <View style={styles.row}><Text style={styles.heading}>Hello, {session.name}.</Text><Pressable disabled={busy} onPress={() => void run(async () => { await clearSession(); setSession(null); setJobs([]); await driverApi(session, "logout/", "POST"); })}><Text style={styles.link}>Sign out</Text></Pressable></View>
      <View style={styles.health}><Text style={styles.label}>{health.active ? "Background tracking is on" : "Tracking is off"}</Text><Text style={styles.copy}>{health.lastError || "Only share your location during an active delivery. Stop tracking when you finish."}</Text></View>
      <Pressable disabled={busy} onPress={() => void run(() => refresh(session))}><Text style={styles.link}>Refresh assignments</Text></Pressable>
      {!jobs.length && <Text style={styles.copy}>No active assignments. Your next delivery will appear here.</Text>}
      {jobs.map((job) => <View key={job.id} style={styles.job}>
        <Text style={styles.label}>#{job.id.slice(0, 8).toUpperCase()} · {job.status.replaceAll("_", " ")}</Text>
        <Text style={styles.jobTitle}>{job.items.map((item) => `${item.quantity} ${item.unit} ${item.name}`).join("\n")}</Text>
        <Text style={styles.copy}>Pickup: {job.items[0]?.location}</Text><Text style={styles.copy}>Deliver to: {job.address}</Text>
        {job.payment_status !== "succeeded" && <Text style={styles.error}>Not dispatchable: payment is not verified. Demo jobs cannot be dispatched.</Text>}
        <Pressable style={styles.outline} onPress={() => void run(async () => {
          await Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(job.status === "processing" ? job.items[0]?.location || "" : job.address)}`);
        })}><Text style={styles.link}>Open navigation</Text></Pressable>
        {["picked", "en_route"].includes(job.status) && <Pressable disabled={busy} style={styles.outline} onPress={() => void run(async () => {
          if (health.active && health.orderId === job.id) await stopTracking();
          else {
            if (health.active) throw new Error("Stop tracking the current delivery before switching jobs.");
            await startTracking(session, job.id);
          }
          setHealth(await trackingHealth());
        })}><Text style={styles.link}>{health.active && health.orderId === job.id ? "Stop location sharing" : "Start background location"}</Text></Pressable>}
        {job.status !== "en_route" && <Pressable disabled={busy || job.payment_status !== "succeeded"} style={[styles.button, job.payment_status !== "succeeded" && styles.disabled]} onPress={() => void run(async () => {
          await driverApi(session, `orders/${job.id}/transition/`, "POST", { status: job.status === "processing" ? "picked" : "en_route" });
          await refresh(session);
        })}><Text style={styles.buttonText}>{job.status === "processing" ? "Confirm pickup" : "Start delivery"}</Text></Pressable>}
        {job.status === "en_route" && <Pressable disabled={busy} style={styles.button} onPress={() => Alert.alert("Confirm handover", "Only confirm after handing the produce to the recipient. This first version records driver attestation, not customer OTP proof.", [{ text: "Not yet", style: "cancel" }, { text: "Confirm delivery", onPress: () => void run(async () => {
          await driverApi(session, `orders/${job.id}/transition/`, "POST", { status: "delivered" });
          if (health.orderId === job.id) await stopTracking();
          await refresh(session);
        }) }])}><Text style={styles.buttonText}>Complete delivery</Text></Pressable>}
      </View>)}
    </>}
    <Text style={styles.footnote}>Location delivery depends on connectivity, permissions, battery settings and OS restrictions. Force-closing the app can interrupt tracking.</Text>
  </ScrollView></View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#fff" },
  content: { padding: 24, paddingTop: 65, paddingBottom: 55, gap: 14 },
  brand: { fontSize: 28, color: "#5c7952", fontWeight: "700" },
  light: { fontWeight: "400", color: "#232b25" },
  intro: { fontSize: 14, color: "#6a716b", marginBottom: 20 },
  heading: { fontSize: 24, fontWeight: "600", color: "#232b25", flexShrink: 1 },
  copy: { fontSize: 15, lineHeight: 23, color: "#626b60" },
  label: { fontSize: 14, color: "#293a23", fontWeight: "600" },
  input: { borderWidth: 1, borderColor: "#dce2d7", borderRadius: 9, padding: 13, fontSize: 16, color: "#232b25" },
  button: { backgroundColor: "#5c7952", padding: 15, borderRadius: 8, alignItems: "center" },
  buttonText: { color: "white", fontSize: 16, fontWeight: "600" },
  outline: { borderWidth: 1, borderColor: "#dce2d7", padding: 13, borderRadius: 8, alignItems: "center" },
  link: { color: "#435c3a", fontSize: 15, fontWeight: "600" },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 15 },
  health: { padding: 17, backgroundColor: "#f3f6ef", borderRadius: 10, gap: 7 },
  job: { borderWidth: 1, borderColor: "#e9ece6", borderRadius: 12, padding: 18, gap: 14, marginTop: 10 },
  jobTitle: { fontSize: 18, color: "#232b25", fontWeight: "600", lineHeight: 27 },
  error: { padding: 14, backgroundColor: "#fff3ef", color: "#8d3926", borderRadius: 8, lineHeight: 22 },
  disabled: { opacity: .4 },
  footnote: { fontSize: 12, color: "#6a716b", lineHeight: 19, marginTop: 20 },
});
