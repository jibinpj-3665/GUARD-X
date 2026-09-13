/* ============================================================
   GUARD-X DASHBOARD RENDERING + DEMO SIMULATOR + MAP (js/dashboard.js)
   JSON parsing lives in api.js — this file only renders UI.
   ============================================================ */

const $ = (id) => document.getElementById(id);
// Safe DOM helpers — every page only contains some panels, so missing IDs are normal.
function setT(id, v) { const e = $(id); if (e) e.textContent = v; }
function setW(id, p) { const e = $(id); if (e) e.style.width = p; }
let map = null, roverMarker = null, routeLine = null, roadLine = null, lastGps = null;
let demoState = null;

/* ---------------- EVENT LOG ---------------- */
function timestamp() {
  return new Date().toTimeString().slice(0, 8);
}
function addLog(msg, type = "") {
  const ul = $("event-log");
  if (!ul) return;
  const li = document.createElement("li");
  if (type) li.className = type;
  const t = document.createElement("span");
  t.className = "t";
  t.textContent = timestamp();
  const m = document.createElement("span");
  m.textContent = msg;
  li.appendChild(t); li.appendChild(m);
  ul.prepend(li);
  while (ul.children.length > 80) ul.removeChild(ul.lastChild);
}

function toast(msg, kind = "") {
  const w = $("toast-wrap");
  if (!w) return;
  const d = document.createElement("div");
  d.className = "toast " + kind;
  d.textContent = msg;
  w.appendChild(d);
  setTimeout(() => d.remove(), 3200);
}

/* ---------------- CONNECTION UI ---------------- */
function updateConnectionUI() {
  const online = GuardXState.online;
  const demo = GuardXState.demoMode;
  const pill = $("conn-pill"), txt = $("conn-text");
  if (pill && txt) {
    pill.classList.toggle("online", online);
    pill.classList.toggle("offline", !online);
    txt.textContent = online ? "🟢 ONLINE" : "🔴 OFFLINE";
  }
  const sc = $("st-connection");
  if (sc) {
    if (online) { sc.textContent = demo ? "ONLINE (DEMO LINK)" : "ONLINE"; sc.className = "ok"; }
    else { sc.textContent = demo ? "OFFLINE — DEMO DATA" : "OFFLINE"; sc.className = "bad"; }
  }
  const hip = $("header-ip");
  const ipBox = $("esp-ip");
  if (hip && ipBox) hip.textContent = ipBox.value.trim() || GUARDX_CONFIG.ESP32_IP;
  const banner = $("demo-banner-top"), note = $("demo-note");
  const showDemo = demo && !online;
  if (banner) banner.classList.toggle("hidden", !showDemo);
  if (note) note.classList.toggle("hidden", !showDemo);
  const wt = $("wifi-text"), wb = $("wifi-bars");
  if (wt) wt.textContent = online ? "excellent" : (demo ? "simulated" : "no link");
  if (wb) wb.style.opacity = online || demo ? "1" : ".3";
  const lg = $("link-guard");
  if (lg) { lg.textContent = online ? "LINK OK" : (demo ? "DEMO (TX BLOCKED)" : "ARMED — TX BLOCKED"); }
}

function onCommandResult(cmd, ok, isDemo) {
  const lc = $("last-cmd"), la = $("last-ack");
  if (lc) lc.textContent = GuardXState.lastCommand;
  if (la) la.textContent = GuardXState.lastAck + (ok ? (isDemo ? " • simulated" : " • ACK") : " • FAILED");
  updateConnectionUI();
  if (!ok) toast("ESP32 unreachable — command failed", "err");
  else if (isDemo) { /* quiet, already logged where useful */ }
  else toast("ACK: " + cmd, "ok");
}

function onModeChanged(mode, isDemo) {
  renderMode(mode);
  addLog("MODE → " + mode + (isDemo ? " (DEMO)" : ""), mode === "AUTONOMOUS" ? "ok" : "");
  updateConnectionUI();
}

function renderMode(mode) {
  GuardXState.mode = mode;
  ["mode-badge", "header-mode", "st-mode", "oled-mode"].forEach((id) => {
    const el = $(id);
    if (el) el.textContent = mode;
  });
  const mb = $("mode-badge");
  if (mb) { mb.style.color = mode === "AUTONOMOUS" ? "var(--green)" : "var(--cyan)"; }
  const mm = $("mode-manual"), ma = $("mode-auto");
  if (mm && ma) {
    mm.classList.toggle("active", mode === "MANUAL");
    ma.classList.toggle("active", mode === "AUTONOMOUS");
  }
}

/* ---------------- SENSOR HELPERS ---------------- */
function distClass(cm) {
  if (cm < 0) return { c: "", t: "NO DATA" };
  if (cm < 25) return { c: "danger", t: "🔴 OBSTACLE" };
  if (cm < 60) return { c: "caution", t: "🟡 CAUTION" };
  return { c: "safe", t: "🟢 CLEAR" };
}
function fmtCoord(v) { return isFinite(v) ? v.toFixed(5) : "—"; }

/* ---------------- MAIN RENDER ---------------- */
function renderTelemetry(d) {
  const isDemo = !!d._demo;
  GuardXState.lastTelemetry = { ...d, _demo: undefined };

  // status
  renderMode(d.mode || GuardXState.mode);
  GuardXState.direction = d.direction || GuardXState.direction;
  GuardXState.speed = d.speed;
  const pct = Math.round((d.speed / 255) * 100);
  setT("st-direction", d.direction);
  setT("st-speed", d.speed + " / 255 (" + pct + "%)");
  setW("speed-bar", pct + "%");
  setT("speed-val2", pct + "%");
  setT("battery-val", d.battery + "%");
  const bb = $("battery-bar");
  if (bb) { bb.style.width = d.battery + "%"; bb.classList.toggle("low", d.battery < 25); }
  const sys = $("st-system"), sl = $("sys-line");
  if (d.vibration) { sys.textContent = "INTRUSION"; sys.className = "bad"; }
  else if (d.front >= 0 && d.front < 25) { sys.textContent = "AVOIDING"; sys.className = "warn"; }
  else { sys.textContent = "NOMINAL"; sys.className = "ok"; }
  if (sl) sl.textContent = (isDemo ? "[DEMO] " : "") + "poll " + timestamp() + " • front " + d.front + "cm • " + d.mode + " • " + d.direction;

  // distances
  [["front", "FRONT"], ["left", "LEFT"], ["right", "RIGHT"]].forEach(([k]) => {
    const v = d[k];
    const { c, t } = distClass(v);
    const card = $("card-" + k);
    if (card) card.className = "dist " + c;
    const val = $(k + "-val"), bar = $(k + "-bar"), st = $(k + "-state");
    if (val) val.textContent = v < 0 ? "--" : v;
    if (bar) {
      const w = v < 0 ? 0 : Math.min(100, (v / 200) * 100);
      bar.style.width = w + "%";
      bar.style.background = c === "danger" ? "var(--red)" : c === "caution" ? "var(--orange)" : "";
    }
    if (st) st.textContent = t;
    const sv = $("sur-" + k), dot = $("sur-" + k + "-dot");
    if (sv) sv.textContent = (v < 0 ? "--" : v) + " cm";
    if (dot) dot.className = "sdot " + (c || "safe");
  });
  // fov intensity follows clearance
  const fov = (id, v) => {
    const el = $(id);
    if (!el) return;
    el.style.opacity = v < 0 ? ".15" : v < 25 ? ".85" : v < 60 ? ".5" : ".25";
    el.style.background = v >= 0 && v < 25
      ? "linear-gradient(180deg,rgba(255,45,85,.7),transparent)"
      : "linear-gradient(180deg,rgba(0,229,255,.6),transparent)";
  };
  fov("fov-front", d.front); fov("fov-left", d.left); fov("fov-right", d.right);

  // env
  setT("temp-val", isFinite(d.temperature) ? d.temperature.toFixed(1) : "--");
  setT("hum-val", isFinite(d.humidity) ? Math.round(d.humidity) : "--");
  const vib = $("vib-val");
  if (vib) {
    vib.textContent = d.vibration ? "INTRUSION" : "NORMAL";
    vib.style.color = d.vibration ? "var(--red)" : "var(--green)";
  }

  // accel (-2g..2g → 0..100%)
  const acc = (id, v) => {
    const e2 = $(id + "-val"), bar2 = $(id + "-bar");
    if (e2) e2.textContent = v.toFixed(2);
    if (bar2) bar2.style.width = Math.max(0, Math.min(100, ((v + 2) / 4) * 100)) + "%";
  };
  acc("accx", d.accelX); acc("accy", d.accelY); acc("accz", d.accelZ);

  // gps mini + panel
  setT("lat-mini", fmtCoord(d.latitude));
  setT("lon-mini", fmtCoord(d.longitude));
  const fm = $("fix-mini");
  if (fm) { fm.textContent = d.gpsFix ? "LOCKED" : "SEARCHING"; fm.style.color = d.gpsFix ? "var(--green)" : "var(--orange)"; }
  setT("sats-mini", d.satellites);
  const bz = $("buzzer-val");
  if (bz) { bz.textContent = d.vibration ? "ON" : "OFF"; bz.style.color = d.vibration ? "var(--red)" : "var(--muted)"; }

  renderSecurity(d);
  renderOled(d);
  renderDecision(d);
  renderRoverDir(d.direction);
  updateMapPosition(d, isDemo);
  const lp = $("last-poll");
  if (lp) lp.textContent = "last poll: " + timestamp() + (isDemo ? " (demo)" : " (live)");
}

/* ---------------- AUTONOMOUS DECISION ---------------- */
function renderDecision(d) {
  const el = $("decision");
  if (!el) return;
  let text = "PATH CLEAR", cls = "decision";
  if (d.vibration) { text = "🚨 INTRUSION DETECTED"; cls += " danger"; }
  else if (GuardXState.mode !== "AUTONOMOUS") {
    text = d.front >= 0 && d.front < 25 ? "OBSTACLE DETECTED (MANUAL)" : "PATH CLEAR (MANUAL)";
    cls += d.front >= 0 && d.front < 25 ? " danger" : "";
  }
  else if (d.front >= 0 && d.front < 25) {
    text = d.left >= d.right ? "OBSTACLE — TURNING LEFT" : "OBSTACLE — TURNING RIGHT";
    cls += " danger";
  }
  else if (d.front >= 0 && d.front < 60) { text = "CAUTION — SLOW FORWARD"; cls += " caution"; }
  else { text = "FORWARD — PATH CLEAR"; }
  if (el.textContent !== text) {
    const prev = el.textContent;
    el.textContent = text;
    el.className = cls;
    if (/OBSTACLE|INTRUSION|TURNING/.test(text) && !/OBSTACLE|INTRUSION|TURNING/.test(prev)) {
      addLog(text, /INTRUSION/.test(text) ? "alarm" : "warn");
    }
  }
}

/* ---------------- ROVER DIRECTION ---------------- */
function renderRoverDir(dir) {
  const el = $("rover-dir"), arrow = $("dir-arrow");
  if (el) el.textContent = dir || "STOP";
  if (arrow) {
    arrow.setAttribute("class", "dir-" + (
      dir === "LEFT" ? "left" : dir === "RIGHT" ? "right"
      : dir === "REVERSE" || dir === "BACKWARD" ? "back"
      : dir === "FORWARD" ? "fwd" : "stop"));
  }
  document.querySelectorAll(".wheel").forEach((w) => {
    w.classList.toggle("spin", dir && dir !== "STOP");
  });
}

/* ---------------- SECURITY ---------------- */
function renderSecurity(d) {
  const badge = $("secure-badge"), panel = $("security-panel");
  const vib = $("sec-vib"), buz = $("sec-buzzer"), al = $("sec-alert");
  const msg = $("alert-msg"), ack = $("btn-ack");
  const tripped = !!d.vibration;
  if (badge) {
    badge.textContent = tripped ? "🔴 INTRUSION DETECTED" : "🟢 SECURE";
    badge.className = "secure-badge " + (tripped ? "alarm" : "ok");
  }
  if (vib) { vib.textContent = tripped ? "TRIPPED" : "NORMAL"; vib.style.color = tripped ? "var(--red)" : "var(--green)"; }
  if (buz) { buz.textContent = tripped ? "ON" : "OFF"; buz.style.color = tripped ? "var(--red)" : "var(--muted)"; }
  if (al) al.textContent = tripped ? (GuardXState.acknowledged ? "ACKNOWLEDGED" : "ACTIVE — UNACKED") : "NONE";
  if (msg) msg.classList.toggle("hidden", !tripped);
  if (ack) ack.disabled = !tripped;
  const wasAlarm = document.body.classList.contains("alarm");
  document.body.classList.toggle("alarm", tripped && !GuardXState.acknowledged);
  if (tripped && !wasAlarm) {
    addLog("🚨 VIBRATION — INTRUSION DETECTED", "alarm");
    GuardXState.acknowledged = false;
    document.body.classList.add("alarm");
  }
  if (!tripped && !GuardXState.acknowledged) GuardXState.acknowledged = true;
}

/* ---------------- OLED MIRROR ---------------- */
function renderOled(d) {
  const set = (id, v) => { const e = $(id); if (e) e.textContent = v; };
  set("oled-status", GuardXState.online ? "ONLINE" : (d._demo ? "DEMO" : "OFFLINE"));
  set("oled-mode", d.mode);
  set("oled-temp", isFinite(d.temperature) ? d.temperature.toFixed(1) : "--.-");
  set("oled-dist", d.front < 0 ? "---" : d.front);
  set("oled-batt", d.battery);
  set("oled-dir", d.direction);
}

/* ---------------- DEMO SIMULATOR ----------------
   Only used when ESP32 is unreachable. Clearly flagged. */
function resetDemo() {
  demoState = {
    front: 85, left: 72, right: 64, temp: 28.4, hum: 62,
    lat: 10.5276, lon: 76.2144, sats: 7, fix: true,
    vibTimer: 0, t: 0, dir: "STOP"
  };
}
function generateDemoSensorData() {
  if (!demoState) resetDemo();
  const s = demoState;
  s.t++;
  // wander distances with occasional obstacle events
  s.front += (Math.random() - 0.5) * 14;
  s.left += (Math.random() - 0.5) * 10;
  s.right += (Math.random() - 0.5) * 10;
  if (s.t % 14 === 0) s.front = 12 + Math.random() * 15;   // obstacle passes by
  if (s.t % 23 === 0) s.right = 15 + Math.random() * 12;
  s.front = Math.max(8, Math.min(220, s.front));
  s.left = Math.max(8, Math.min(220, s.left));
  s.right = Math.max(8, Math.min(220, s.right));
  s.temp = 27 + Math.sin(s.t / 20) * 1.5 + Math.random() * 0.3;
  s.hum = 60 + Math.sin(s.t / 30) * 6 + Math.random() * 1.5;
  // GPS drift (labelled DEMO DATA downstream)
  if (s.fix) {
    s.lat += (Math.random() - 0.45) * 0.00012;
    s.lon += (Math.random() - 0.45) * 0.00012;
  }
  if (s.t % 40 === 0) s.fix = !s.fix; // occasionally lose fix to demo that state
  if (!s.fix) s.sats = 2 + Math.floor(Math.random() * 2);
  else s.sats = 6 + Math.floor(Math.random() * 4);
  // vibration intrusion blip every ~45 polls for 3 polls
  if (s.t % 45 === 0) s.vibTimer = 3;
  const vib = s.vibTimer > 0;
  if (s.vibTimer > 0) s.vibTimer--;
  return {
    front: Math.round(s.front), left: Math.round(s.left), right: Math.round(s.right),
    temperature: +s.temp.toFixed(1), humidity: +s.hum.toFixed(0),
    accelX: +(Math.random() * 0.1 - 0.05).toFixed(2),
    accelY: +(Math.random() * 0.1 - 0.05).toFixed(2),
    accelZ: +(0.95 + Math.random() * 0.08).toFixed(2),
    latitude: +s.lat.toFixed(5), longitude: +s.lon.toFixed(5),
    satellites: s.sats, gpsFix: s.fix, vibration: vib,
    battery: Math.max(20, 88 - Math.floor(s.t / 60)),
    mode: GuardXState.mode, speed: GuardXState.speed, direction: GuardXState.direction
  };
}

/* ---------------- LEAFLET MAP ---------------- */
function initMap() {
  const el = $("gps-map");
  if (!el) return;
  if (typeof L === "undefined") {
    el.innerHTML = '<div style="padding:30px;color:var(--muted);font-family:var(--mono)">Map library failed to load (no internet?).<br>Lat/Lon still shown beside the map.</div>';
    return;
  }
  map = L.map("gps-map", { zoomControl: true }).setView([10.5276, 76.2144], 16);
  const tileUrl = getMapTileUrl();
  const tiles = L.tileLayer(tileUrl, {
    maxZoom: GUARDX_CONFIG.MAP_MAX_ZOOM,
    attribution: GUARDX_CONFIG.MAP_ATTRIBUTION
  });
  tiles.addTo(map);
  map._tileLayer = tiles;
  const icon = L.divIcon({ className: "", html: '<div class="rover-marker searching">🤖</div>', iconSize: [30, 30], iconAnchor: [15, 15] });
  roverMarker = L.marker([10.5276, 76.2144], { icon }).addTo(map).bindPopup("GUARD-X");
  routeLine = L.polyline([], { color: "#00e5ff", weight: 3, opacity: 0.9 }).addTo(map);
  roadLine = L.polyline([], { color: "#ffaa00", weight: 4, opacity: 0.95, dashArray: "8 6" }).addTo(map);
  setT("map-src-tag", tileUrl.includes("openstreetmap") ? "OSM • NO KEY" : "CUSTOM SOURCE");
}

function refreshMapSource() {
  if (!map || typeof L === "undefined") { initMap(); return; }
  const url = getMapTileUrl();
  if (map && map._tileLayer) map._tileLayer.setUrl(url);
  setT("map-src-tag", url.includes("openstreetmap") ? "OSM • NO KEY" : "CUSTOM SOURCE");
  toast("Map source updated", "ok");
}

function computeHeading(a, b) {
  if (!a || !b) return NaN;
  const toR = (d) => d * Math.PI / 180, toD = (r) => r * 180 / Math.PI;
  const dLon = toR(b[1] - a[1]);
  const y = Math.sin(dLon) * Math.cos(toR(b[0]));
  const x = Math.cos(toR(a[0])) * Math.sin(toR(b[0])) - Math.sin(toR(a[0])) * Math.cos(toR(b[0])) * Math.cos(dLon);
  return (toD(Math.atan2(y, x)) + 360) % 360;
}

function updateMapPosition(d, isDemo) {
  setT("gps-lat", fmtCoord(d.latitude) + (isDemo && isFinite(d.latitude) ? " (demo)" : ""));
  setT("gps-lon", fmtCoord(d.longitude) + (isDemo && isFinite(d.longitude) ? " (demo)" : ""));
  setT("gps-sats", d.satellites);
  setT("map-coords", fmtCoord(d.latitude) + ", " + fmtCoord(d.longitude));
  const badge = $("gps-fix-badge");
  if (badge) {
    badge.textContent = d.gpsFix ? "GPS LOCKED" : "GPS SEARCHING";
    badge.className = "badge " + (d.gpsFix ? "ok" : "warn");
  }
  if (!map || !roverMarker) return;
  if (!isFinite(d.latitude) || !isFinite(d.longitude)) return;
  const pos = [d.latitude, d.longitude];
  const iconHtml = '<div class="rover-marker' + (d.gpsFix ? "" : " searching") + '">🤖</div>';
  roverMarker.setIcon(L.divIcon({ className: "", html: iconHtml, iconSize: [30, 30], iconAnchor: [15, 15] }));
  if (!d.gpsFix) {
    roverMarker.setLatLng(pos);
    roverMarker.bindPopup("GUARD-X — GPS SEARCHING (no route)");
    return; // do NOT draw route without fix
  }
  roverMarker.setLatLng(pos);
  // heading: prefer ESP32 heading, else compute from last fix
  let h = d.heading;
  if (!isFinite(h) && lastGps) h = computeHeading(lastGps, pos);
  setT("gps-heading", isFinite(h) ? Math.round(h) + "°" : d.direction || "—");
  lastGps = pos;
  // append to route (ignore duplicates / tiny jitter < ~2m)
  const r = GuardXState.route;
  const last = r[r.length - 1];
  if (!last || Math.abs(last[0] - pos[0]) > 0.00002 || Math.abs(last[1] - pos[1]) > 0.00002) {
    r.push(pos);
    if (routeLine) routeLine.setLatLngs(r);
    setT("gps-points", r.length);
  }
  roverMarker.bindPopup("GUARD-X<br>" + pos[0].toFixed(5) + ", " + pos[1].toFixed(5) + (isDemo ? "<br>DEMO DATA" : ""));
  if (GuardXState.followMap) map.setView(pos, Math.max(map.getZoom(), 16), { animate: true });
}

/* ---------------- API KEYS STATUS ---------------- */
function renderApiKeyStatus() {
  const ors = (typeof getOrsKey === "function" && getOrsKey()) || "";
  const gem = (typeof getGeminiKey === "function" && getGeminiKey()) || "";
  const oEl = $("ors-status"), gEl = $("gemini-status");
  if (oEl) {
    oEl.innerHTML = ors ? "<i></i>CONNECTED" : "<i></i>NOT SET";
    oEl.classList.toggle("off", !ors);
  }
  if (gEl) {
    gEl.innerHTML = gem ? "<i></i>CONNECTED" : "<i></i>NOT SET";
    gEl.classList.toggle("off", !gem);
  }
  const ai = $("ai-status");
  if (ai) {
    ai.textContent = gem ? "READY" : "NO KEY";
    ai.className = "badge " + (gem ? "ok" : "warn");
  }
}

/* ---------------- ORS ROAD OVERLAY ---------------- */
function drawRoadGeometry(latlon) {
  if (!map || !roadLine || typeof L === "undefined") return;
  roadLine.setLatLngs(latlon || []);
  const st = $("ors-road-status");
  if (st) st.textContent = "Road geometry: " + (latlon && latlon.length ? latlon.length + " pts snapped to real roads (ORS)" : "cleared");
}
function clearRoadGeometry() {
  if (roadLine) roadLine.setLatLngs([]);
  const st = $("ors-road-status");
  if (st) st.textContent = "Road geometry: straight-line track (add ORS key for real roads)";
}

/* ---------------- AI OUTPUT ---------------- */
function setAiOutput(text, loading) {
  const el = $("ai-output");
  if (!el) return;
  el.textContent = text;
  el.classList.toggle("loading", !!loading);
}
