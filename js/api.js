/* ============================================================
   GUARD-X ESP32 COMMUNICATION LAYER  (js/api.js)
   ------------------------------------------------------------
   SINGLE PLACE TO CONFIGURE EVERYTHING ESP32-RELATED.
   All HTTP requests use ESP32_IP — change it once here
   (or live in the dashboard IP box).
   ============================================================ */

// ---- 1. MAIN CONFIG — EDIT THIS ----
const ESP32_IP = "192.168.4.1";

const GUARDX_CONFIG = {
  ESP32_IP: ESP32_IP,               // <-- ESP32 Wi-Fi address (AP default 192.168.4.1)
  PROTOCOL: "http://",
  TIMEOUT_MS: 3500,                 // fetch abort timeout
  POLL_INTERVAL_MS: 1500,           // telemetry poll rate
  SENSOR_ENDPOINT: "/status",       // ESP32 JSON endpoint (must return sensor JSON)

  ENDPOINTS: {
    forward:   "/forward",
    backward:  "/backward",
    left:      "/left",
    right:     "/right",
    stop:      "/stop",
    speed:     "/speed",            // + ?value=0..255
    mode:      "/mode",             // + ?value=auto | manual
    autoStart: "/mode?value=auto",
    autoStop:  "/mode?value=manual",
    sensors:   "/status"
  },

  // ---- 2. MAP CONFIG (Leaflet + OpenStreetMap) ----
  // OSM needs NO key. If you want a keyed provider, paste key + template:
  //   Example MapTiler: "https://api.maptiler.com/maps/streets/{z}/{x}/{y}.png?key={apikey}"
  //   Example Thunderforest: "https://tile.thunderforest.com/atlas/{z}/{x}/{y}.png?apikey={apikey}"
  MAP_API_KEY: "",                  // <-- PASTE YOUR MAP API KEY HERE (optional, OSM works without it)
  MAP_TILE_URL_DEFAULT: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
  MAP_ATTRIBUTION: "© OpenStreetMap contributors",
  MAP_MAX_ZOOM: 19,

  // ---- 2b. OPTIONAL BRING-YOUR-OWN KEYS (also editable in UI, stored in localStorage) ----
  // Baked-in ORS default so road routing works out of the box (Gemini stays bring-your-own).
  ORS_KEY: "eyJvcmciOiI1YjNjZTM1OTc4NTExMTAwMDFjZjYyNDgiLCJpZCI6IjAzODJmODZkMjU0YzQxYTNhOGViOTBlOGRkYjRmZTlmIiwiaCI6Im11cm11cjY0In0=",
  GEMINI_KEY: "",                    // paste in KEYS page → localStorage only
  GEMINI_MODEL: "gemini-3.6-flash"   // primary model (verified live); fallbacks below
};
const GEMINI_MODEL_FALLBACKS = ["gemini-3.6-flash", "gemini-3.5-flash-lite", "gemini-flash-latest"];

// ---- 3. RUNTIME STATE (shared) ----
const GuardXState = {
  online: false,          // true only after a REAL successful ESP32 response
  demoMode: true,         // simulation fallback, toggle in header
  mode: "MANUAL",         // MANUAL | AUTONOMOUS
  direction: "STOP",
  speed: 150,
  lastAck: "—",
  lastCommand: "—",
  acknowledged: true,     // intrusion ack flag
  followMap: true,
  route: [],               // [[lat,lon],...] travelled path (persisted per tab)
  distM: 0,                // metres travelled in this session
  fence: [],               // [[lat,lon],...] restricted-area boundary
  marking: false,          // true while user taps map to draw fence
  fenceInside: false,      // last known inside/outside state
  wsLastMsg: 0,            // timestamp of last WebSocket telemetry frame
  lastTelemetry: null      // latest parsed sensor snapshot (for AI analysis)
};

function getBaseUrl() {
  const ipInput = document.getElementById("esp-ip");
  const ip = (ipInput && ipInput.value.trim()) || GUARDX_CONFIG.ESP32_IP || ESP32_IP;
  return GUARDX_CONFIG.PROTOCOL + ip;
}

function getSensorUrl() {
  const epInput = document.getElementById("sensor-endpoint");
  const ep = (epInput && epInput.value.trim()) || GUARDX_CONFIG.SENSOR_ENDPOINT || "/status";
  return getBaseUrl() + (ep.startsWith("/") ? ep : "/" + ep);
}

function getMapTileUrl() {
  const keyInput = document.getElementById("map-key");
  const tplInput = document.getElementById("map-tile");
  const key = (keyInput && keyInput.value.trim()) || GUARDX_CONFIG.MAP_API_KEY || "";
  let tpl = (tplInput && tplInput.value.trim()) || GUARDX_CONFIG.MAP_TILE_URL_DEFAULT;
  if (tpl.includes("{apikey}") || tpl.includes("{apiKey}")) {
    tpl = tpl.replace("{apikey}", key).replace("{apiKey}", key);
  } else if (key && (tpl.includes("maptiler") || tpl.includes("thunderforest") || tpl.includes("mapbox"))) {
    tpl += (tpl.includes("?") ? "&" : "?") + "key=" + encodeURIComponent(key);
  }
  return tpl;
}

// ---- 4. LOW-LEVEL FETCH WITH TIMEOUT ----
async function espFetch(path) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), GUARDX_CONFIG.TIMEOUT_MS);
  try {
    const res = await fetch(getBaseUrl() + path, { signal: ctrl.signal, cache: "no-store" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    return res;
  } finally {
    clearTimeout(t);
  }
}

function setOnline(online) {
  GuardXState.online = online;
  if (typeof updateConnectionUI === "function") updateConnectionUI();
}

// ---- 5. COMMAND API (required functions) ----
async function sendCommand(command) {
  const map = GUARDX_CONFIG.ENDPOINTS;
  const path = map[command] || ("/" + command);
  GuardXState.lastCommand = command.toUpperCase() + " → " + path;

  // DEMO MODE: simulate, never fake a real ack
  if (GuardXState.demoMode && !GuardXState.online) {
    GuardXState.direction = command === "stop" ? "STOP"
      : command === "forward" ? "FORWARD"
      : command === "backward" ? "REVERSE"
      : command === "left" ? "LEFT"
      : command === "right" ? "RIGHT" : GuardXState.direction;
    GuardXState.lastAck = "(DEMO) " + new Date().toLocaleTimeString();
    if (typeof onCommandResult === "function") onCommandResult(command, true, true);
    return true;
  }
  // OFFLINE + demo OFF: block movement, stay honest
  if (!GuardXState.online && !GuardXState.demoMode) {
    if (typeof onCommandResult === "function") onCommandResult(command, false, false);
    if (typeof addLog === "function") addLog("CMD BLOCKED — ESP32 OFFLINE (" + command + ")", "warn");
    return false;
  }
  try {
    await espFetch(path);
    GuardXState.lastAck = new Date().toLocaleTimeString();
    GuardXState.direction = command === "stop" ? "STOP"
      : command === "forward" ? "FORWARD"
      : command === "backward" ? "REVERSE"
      : command === "left" ? "LEFT"
      : command === "right" ? "RIGHT" : GuardXState.direction;
    setOnline(true);
    if (typeof onCommandResult === "function") onCommandResult(command, true, false);
    return true;
  } catch (e) {
    setOnline(false);
    if (typeof onCommandResult === "function") onCommandResult(command, false, false);
    if (typeof addLog === "function") addLog("CMD FAILED — " + command + " (" + e.message + ")", "alarm");
    return false;
  }
}

async function setSpeed(value) {
  value = Math.max(0, Math.min(255, parseInt(value, 10) || 0));
  GuardXState.speed = value;
  GuardXState.lastCommand = "SPEED → /speed?value=" + value;
  if (GuardXState.demoMode && !GuardXState.online) {
    GuardXState.lastAck = "(DEMO) " + new Date().toLocaleTimeString();
    if (typeof onCommandResult === "function") onCommandResult("speed:" + value, true, true);
    return true;
  }
  if (!GuardXState.online && !GuardXState.demoMode) {
    if (typeof addLog === "function") addLog("SPEED BLOCKED — ESP32 OFFLINE", "warn");
    return false;
  }
  try {
    await espFetch(GUARDX_CONFIG.ENDPOINTS.speed + "?value=" + value);
    GuardXState.lastAck = new Date().toLocaleTimeString();
    setOnline(true);
    if (typeof onCommandResult === "function") onCommandResult("speed:" + value, true, false);
    return true;
  } catch (e) {
    setOnline(false);
    if (typeof onCommandResult === "function") onCommandResult("speed:" + value, false, false);
    return false;
  }
}

async function setMode(mode) {
  mode = (mode || "").toLowerCase() === "auto" ? "auto" : "manual";
  GuardXState.lastCommand = "MODE → /mode?value=" + mode;
  if (GuardXState.demoMode && !GuardXState.online) {
    GuardXState.mode = mode === "auto" ? "AUTONOMOUS" : "MANUAL";
    GuardXState.lastAck = "(DEMO) " + new Date().toLocaleTimeString();
    if (typeof onModeChanged === "function") onModeChanged(GuardXState.mode, true);
    return true;
  }
  if (!GuardXState.online && !GuardXState.demoMode) {
    if (typeof addLog === "function") addLog("MODE CHANGE BLOCKED — OFFLINE", "warn");
    return false;
  }
  try {
    await espFetch(GUARDX_CONFIG.ENDPOINTS.mode + "?value=" + mode);
    GuardXState.mode = mode === "auto" ? "AUTONOMOUS" : "MANUAL";
    GuardXState.lastAck = new Date().toLocaleTimeString();
    setOnline(true);
    if (typeof onModeChanged === "function") onModeChanged(GuardXState.mode, false);
    return true;
  } catch (e) {
    setOnline(false);
    if (typeof addLog === "function") addLog("MODE CHANGE FAILED (" + e.message + ")", "alarm");
    return false;
  }
}

function startAutonomous() { return setMode("auto"); }
function stopAutonomous()  { return setMode("manual"); }

function emergencyStop() {
  if (typeof addLog === "function") addLog("⛔ EMERGENCY STOP PRESSED", "alarm");
  return sendCommand("stop");
}

// ---- 6. SENSOR API ----
/* Expected ESP32 JSON:
{
  "front": 82, "left": 65, "right": 71,
  "temperature": 28.4, "humidity": 64,
  "accelX": 0.02, "accelY": -0.04, "accelZ": 0.98,
  "latitude": 10.52, "longitude": 76.21,
  "satellites": 7, "gpsFix": true,
  "vibration": false, "battery": 82,
  "mode": "MANUAL", "speed": 180, "direction": "STOP"
} */
function parseSensorJson(raw) {
  const d = (typeof raw === "string") ? JSON.parse(raw) : (raw || {});
  const num = (v, fb) => (typeof v === "number" && isFinite(v)) ? v : fb;
  const ax = num(d.accelX, 0), ay = num(d.accelY, 0), az = num(d.accelZ, 0);
  // Roll/pitch: prefer ESP32 fusion values; else estimate from accelerometer gravity vector
  let roll = num(d.roll, NaN), pitch = num(d.pitch, NaN);
  if (!isFinite(roll)) roll = Math.atan2(ay, az) * 180 / Math.PI;
  if (!isFinite(pitch)) pitch = Math.atan2(-ax, Math.hypot(ay, az)) * 180 / Math.PI;
  return {
    front:       num(d.front, -1),
    left:        num(d.left, -1),
    right:       num(d.right, -1),
    temperature: num(d.temperature, NaN),
    humidity:    num(d.humidity, NaN),
    accelX:      ax,
    accelY:      ay,
    accelZ:      az,
    gyroX:       num(d.gyroX, 0),
    gyroY:       num(d.gyroY, 0),
    gyroZ:       num(d.gyroZ, 0),
    roll:        roll,
    pitch:       pitch,
    yaw:         num(d.yaw, NaN),          // needs gyro/mag fusion on ESP32; NaN = unavailable
    mpuTemp:     num(d.mpuTemp, NaN),
    latitude:    num(d.latitude, NaN),
    longitude:   num(d.longitude, NaN),
    satellites:  Math.max(0, Math.round(num(d.satellites, 0))),
    gpsFix:      d.gpsFix === true,
    vibration:   d.vibration === true,
    battery:     Math.max(0, Math.min(100, Math.round(num(d.battery, 0)))),
    heading:     (d.heading !== undefined) ? num(d.heading, NaN) : NaN,
    mode:        (d.mode === "AUTONOMOUS" || d.mode === "auto") ? "AUTONOMOUS" : "MANUAL",
    speed:       Math.max(0, Math.min(255, Math.round(num(d.speed, GuardXState.speed)))),
    direction:   typeof d.direction === "string" ? d.direction.toUpperCase() : GuardXState.direction
  };
}

async function fetchSensorData() {
  // Demo fallback when offline (clearly labelled downstream)
  if (GuardXState.demoMode && !GuardXState.online) {
    if (typeof generateDemoSensorData === "function") {
      const demo = parseSensorJson(generateDemoSensorData());
      demo._demo = true;
      return demo;
    }
  }
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), GUARDX_CONFIG.TIMEOUT_MS);
  try {
    const res = await fetch(getSensorUrl(), { signal: ctrl.signal, cache: "no-store" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const data = parseSensorJson(await res.json());
    data._demo = false;
    setOnline(true);
    return data;
  } catch (e) {
    // First failure → offline. If demo enabled, serve simulated data but flagged.
    if (GuardXState.online) {
      setOnline(false);
      if (typeof addLog === "function") addLog("⚠ LINK LOST — ESP32 OFFLINE (" + e.message + ")", "alarm");
    } else {
      setOnline(false);
    }
    if (GuardXState.demoMode && typeof generateDemoSensorData === "function") {
      const demo = parseSensorJson(generateDemoSensorData());
      demo._demo = true;
      return demo;
    }
    throw e;
  } finally {
    clearTimeout(t);
  }
}

// Probe connection without needing sensor JSON (tries / then sensor endpoint)
async function probeConnection() {
  try {
    await espFetch("/");
    setOnline(true);
    return true;
  } catch (e1) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), GUARDX_CONFIG.TIMEOUT_MS);
      try {
        const r = await fetch(getSensorUrl(), { signal: ctrl.signal, cache: "no-store" });
        if (r.ok) { setOnline(true); return true; }
      } finally { clearTimeout(t); }
    } catch (e2) { /* offline */ }
    setOnline(false);
    return false;
  }
}

// ---- 7. OPTIONAL API KEYS (localStorage only, never hardcoded) ----
const LS_ORS_KEY = "guardx_ors_key";
const LS_GEMINI_KEY = "guardx_gemini_key";

function getOrsKey() {
  const el = document.getElementById("ors-key");
  const v = (el && el.value.trim()) || GUARDX_CONFIG.ORS_KEY || "";
  return v;
}
function getGeminiKey() {
  const el = document.getElementById("gemini-key");
  const v = (el && el.value.trim()) || GUARDX_CONFIG.GEMINI_KEY || "";
  return v;
}
function loadApiKeys() {
  try {
    const ors = localStorage.getItem(LS_ORS_KEY) || "";
    const gem = localStorage.getItem(LS_GEMINI_KEY) || "";
    if (ors) GUARDX_CONFIG.ORS_KEY = ors;
    if (gem) GUARDX_CONFIG.GEMINI_KEY = gem;
    const oEl = document.getElementById("ors-key");
    const gEl = document.getElementById("gemini-key");
    if (oEl && !oEl.value) oEl.value = GUARDX_CONFIG.ORS_KEY || "";
    if (gEl && !gEl.value) gEl.value = GUARDX_CONFIG.GEMINI_KEY || "";
  } catch (e) { /* private mode */ }
  if (typeof renderApiKeyStatus === "function") renderApiKeyStatus();
}
function saveApiKeys() {
  const ors = getOrsKey(), gem = getGeminiKey();
  GUARDX_CONFIG.ORS_KEY = ors;
  GUARDX_CONFIG.GEMINI_KEY = gem;
  try {
    if (ors) localStorage.setItem(LS_ORS_KEY, ors); else localStorage.removeItem(LS_ORS_KEY);
    if (gem) localStorage.setItem(LS_GEMINI_KEY, gem); else localStorage.removeItem(LS_GEMINI_KEY);
  } catch (e) { /* ignore */ }
  if (typeof renderApiKeyStatus === "function") renderApiKeyStatus();
  return { ors: !!ors, gemini: !!gem };
}

// ---- 8. OpenRouteService: snap travelled track to real roads ----
async function fetchRoadGeometry(latlonPairs) {
  const key = getOrsKey();
  if (!key) throw new Error("No OpenRouteService key saved");
  const pts = (latlonPairs || []).filter((p) => isFinite(p[0]) && isFinite(p[1]));
  if (pts.length < 2) throw new Error("Need at least 2 GPS points");
  // ORS allows many coords; keep last 12 to stay within free-tier limits
  const use = pts.slice(-12).map(([lat, lon]) => [lon, lat]);
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 12000);
  try {
    const res = await fetch("https://api.openrouteservice.org/v2/directions/driving-car/geojson", {
      method: "POST",
      signal: ctrl.signal,
      headers: { "Authorization": key, "Content-Type": "application/json" },
      body: JSON.stringify({ coordinates: use })
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error("ORS HTTP " + res.status + (txt ? " — " + txt.slice(0, 120) : ""));
    }
    const gj = await res.json();
    const coords = gj && gj.features && gj.features[0] && gj.features[0].geometry && gj.features[0].geometry.coordinates;
    if (!coords || !coords.length) throw new Error("ORS returned no geometry");
    return coords.map(([lon, lat]) => [lat, lon]); // → Leaflet [lat,lon]
  } finally {
    clearTimeout(t);
  }
}

// ---- 9. Google Gemini: live telemetry analysis ----
function buildTelemetryPrompt(d) {
  return "You are GUARD-X rover safety analyst. Given this ESP32 rover telemetry JSON, reply in 5 short bullet lines: " +
    "1) overall status, 2) obstacle risk, 3) environment note, 4) security/intrusion note, 5) recommended next action. " +
    "Be concise, technical, no fluff.\n" + JSON.stringify(d);
}
async function analyzeWithGemini(telemetry) {
  const key = getGeminiKey();
  if (!key) throw new Error("No Gemini key saved");
  const d = telemetry || GuardXState.lastTelemetry;
  if (!d) throw new Error("No telemetry yet — wait for a poll");
  const prompt = buildTelemetryPrompt(d);
  // try configured model first, then known-good fallbacks (models retire often)
  const configured = (GUARDX_CONFIG.GEMINI_MODEL || "").trim();
  const models = [configured, ...GEMINI_MODEL_FALLBACKS].filter((m, i, a) => m && a.indexOf(m) === i);
  let lastErr = null;
  for (const model of models) {
    try {
      return await geminiGenerate(model, prompt, key);
    } catch (e) {
      lastErr = e;
      // retired/unknown model → try next; auth/quota/overload errors → stop immediately
      if (!/HTTP 404/.test(String((e && e.message) || e))) throw e;
      if (typeof addLog === "function") addLog("Gemini model " + model + " retired, trying next…", "warn");
    }
  }
  throw lastErr || new Error("Gemini request failed");
}
async function geminiGenerate(model, promptText, key) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetch("https://generativelanguage.googleapis.com/v1beta/models/" + encodeURIComponent(model) + ":generateContent?key=" + encodeURIComponent(key), {
      method: "POST",
      signal: ctrl.signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ parts: [{ text: promptText }] }] })
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error("Gemini HTTP " + res.status + (txt ? " — " + txt.slice(0, 160) : ""));
    }
    const j = await res.json();
    const text = j && j.candidates && j.candidates[0] && j.candidates[0].content &&
      j.candidates[0].content.parts && j.candidates[0].content.parts.map((p) => p.text || "").join("");
    if (!text) throw new Error("Gemini returned empty response");
    return text;
  } finally {
    clearTimeout(t);
  }
}

// ---- 10. WebSocket live stream (ESP32 pushes 20–50 Hz; HTTP poll is the fallback) ----
let wsSock = null, wsWanted = false;
function wsUrl() {
  const ipInput = document.getElementById("esp-ip");
  const ip = (ipInput && ipInput.value.trim()) || GUARDX_CONFIG.ESP32_IP || ESP32_IP;
  return "ws://" + ip + ":81/";
}
function wsLive() {
  return !!(wsSock && wsSock.readyState === 1 && (Date.now() - GuardXState.wsLastMsg < 3000));
}
function connectWS() {
  if (typeof WebSocket === "undefined") { toast("WebSocket not supported here", "err"); return; }
  disconnectWS(true);
  wsWanted = true;
  let s;
  try {
    s = new WebSocket(wsUrl());
  } catch (e) {
    if (typeof addLog === "function") addLog("WS unavailable — staying on HTTP poll", "warn");
    return;
  }
  wsSock = s;
  s.onopen = () => {
    if (typeof addLog === "function") addLog("WS stream open — live IMU @ 20–50 Hz", "ok");
    if (typeof toast === "function") toast("WS live stream open", "ok");
    if (typeof updateConnectionUI === "function") updateConnectionUI();
  };
  s.onmessage = (ev) => {
    try {
      const d = parseSensorJson(JSON.parse(ev.data));
      d._demo = false;
      GuardXState.wsLastMsg = Date.now();
      setOnline(true);
      if (typeof renderTelemetry === "function") renderTelemetry(d);
      if (typeof updateConnectionUI === "function") updateConnectionUI();
    } catch (e) { /* ignore malformed frames */ }
  };
  s.onclose = () => {
    if (wsWanted && typeof addLog === "function") addLog("WS closed — HTTP poll fallback", "warn");
    if (typeof updateConnectionUI === "function") updateConnectionUI();
  };
  s.onerror = () => { /* onclose follows; staying on HTTP poll */ };
}
function disconnectWS(silent) {
  wsWanted = false;
  if (wsSock) { try { wsSock.close(); } catch (e) { /* ignore */ } wsSock = null; }
  if (!silent && typeof updateConnectionUI === "function") updateConnectionUI();
}
