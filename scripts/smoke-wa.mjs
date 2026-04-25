// Smoke test del módulo WA. Asume server corriendo en http://localhost:3000
// con admin@local.test / testpass1234 (solo dev local).
import { io } from "socket.io-client";

const URL = process.env.SMOKE_URL || "http://127.0.0.1:3000";
const EMAIL = process.env.SMOKE_EMAIL || "admin@local.test";
const PASSWORD = process.env.SMOKE_PASSWORD || "testpass1234";

let token;

async function api(path, opts = {}) {
  const res = await fetch(URL + path, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(opts.headers || {}),
    },
  });
  const txt = await res.text();
  let body;
  try { body = JSON.parse(txt); } catch { body = txt; }
  if (!res.ok) throw new Error(`${res.status} ${JSON.stringify(body)}`);
  return body;
}

async function main() {
  console.log("→ login admin");
  const login = await api("/api/auth/desktop-login", { method: "POST", body: JSON.stringify({ email: EMAIL, password: PASSWORD }) });
  token = login.token;
  console.log("  token ok, role:", login.user.role);

  console.log("→ crear cuenta");
  const acc = await api("/api/wa/accounts", { method: "POST", body: JSON.stringify({ label: "Smoke 1" }) });
  console.log("  cuenta:", acc.id);

  console.log("→ crear routine");
  const rt = await api("/api/wa/routines", { method: "POST", body: JSON.stringify({ name: "Smoke R", messages: ["x"], targets: ["549111"] }) });
  console.log("  routine:", rt.id);

  console.log("→ attach");
  await api("/api/wa/routines/attach", { method: "POST", body: JSON.stringify({ accountId: acc.id, routineId: rt.id }) });

  console.log("→ stats summary");
  const sm = await api("/api/wa/stats/summary");
  console.log("  ", sm);

  console.log("→ events-by-hour 3h");
  const ebh = await api("/api/wa/stats/events-by-hour?hours=3");
  console.log("  buckets:", ebh.length);

  console.log("→ WS connect con JWT");
  const s = io(URL, { auth: { token }, transports: ["websocket"] });
  await new Promise((res, rej) => { s.on("connect", res); s.on("connect_error", (e) => rej(e)); setTimeout(() => rej(new Error("ws timeout")), 5000); });
  console.log("  ws ok:", s.id);
  s.emit("heartbeat");
  await new Promise((r) => setTimeout(r, 400));

  console.log("→ presence");
  const pres = await api("/api/wa/stats/presence");
  console.log("  ", pres);

  console.log("→ enviar account:event simulado vía WS");
  s.emit("account:event", { accountId: acc.id, type: "smoke-test", payload: { hello: "world" } });
  await new Promise((r) => setTimeout(r, 500));

  console.log("→ events list");
  const evs = await api("/api/wa/events?limit=5");
  console.log("  ", evs.length, "eventos, ultimo type:", evs[0]?.type);

  console.log("→ borrar cuenta y routine");
  await api(`/api/wa/accounts/${acc.id}`, { method: "DELETE" });
  await api(`/api/wa/routines/${rt.id}`, { method: "DELETE" });

  s.disconnect();
  console.log("\n✅ smoke OK");
  setTimeout(() => process.exit(0), 200);
}

main().catch((e) => { console.error("❌", e); process.exit(1); });
