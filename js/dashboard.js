/* ============================================================
   GUARD-X DASHBOARD RENDERING + DEMO SIMULATOR + MAP (js/dashboard.js)
   JSON parsing lives in api.js — this file only renders UI.
   ============================================================ */

const $ = (id) => document.getElementById(id);
// Safe DOM helpers — every page only contains some panels, so missing IDs are normal.
function setT(id, v) { const e = $(id); if (e) e.textContent = v; }
function setW(id, p) { const e = $(id); if (e) e.style.width = p; }
let map = null, roverMarker = null, routeLine = null, roadLine = null;
let fenceLine = null, fencePoly = null, searchMarker = null, lastGps = null;
let demoState = null;
const LS_FENCE = "guardx_fence";   // restricted area persists in this browser
const SS_ROUTE = "guardx_route";   // movement trail persists per tab across pages

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
  // transport badge (WS stream vs HTTP poll vs demo)
  const tb = $("transport-badge");
  if (tb) {
    let t = "DEMO", cls = "badge warn";
    if (GuardXState.online) {
      if (typeof wsLive === "function" && wsLive()) { t = "⚡ WS STREAM"; cls = "badge ok"; }
      else { t = "HTTP POLL"; cls = "badge warn"; }
    } else if (!GuardXState.demoMode) { t = "NO LINK"; }
    tb.textContent = t; tb.className = cls;
  }
  const bz = $("buzzer-val");
  if (bz) { bz.textContent = d.vibration ? "ON" : "OFF"; bz.style.color = d.vibration ? "var(--red)" : "var(--muted)"; }

  renderSecurity(d);
  renderOled(d);
  renderDecision(d);
  renderRoverDir(d.direction);
  renderIMU(d);
  pushImuSample(d);
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

/* ---------------- IMU: numbers + 3D orientation + safety ---------------- */
function fmtDeg(v) { return isFinite(v) ? v.toFixed(1) + "°" : "—"; }

function renderIMU(d) {
  setT("roll-val", fmtDeg(d.roll));
  setT("pitch-val", fmtDeg(d.pitch));
  setT("yaw-val", fmtDeg(d.yaw));
  setT("tilt-val", Math.hypot(isFinite(d.roll) ? d.roll : 0, isFinite(d.pitch) ? d.pitch : 0).toFixed(1) + "°");
  setT("iax", d.accelX.toFixed(2) + " g");
  setT("iay", d.accelY.toFixed(2) + " g");
  setT("iaz", d.accelZ.toFixed(2) + " g");
  setT("igx", d.gyroX.toFixed(1) + " °/s");
  setT("igy", d.gyroY.toFixed(1) + " °/s");
  setT("igz", d.gyroZ.toFixed(1) + " °/s");
  setT("mpu-temp-val", isFinite(d.mpuTemp) ? d.mpuTemp.toFixed(1) + " °C" : "--");
  // CSS-3D rover: no libraries, works offline from the ESP32 AP too
  const tiltDeg = Math.hypot(isFinite(d.roll) ? d.roll : 0, isFinite(d.pitch) ? d.pitch : 0);
  const cube = $("cube3d");
  if (cube) {
    const r = isFinite(d.roll) ? d.roll : 0;
    const p = isFinite(d.pitch) ? d.pitch : 0;
    const y = isFinite(d.yaw) ? d.yaw : 0;
    cube.style.transform = "rotateX(" + (-p).toFixed(1) + "deg) rotateY(" + y.toFixed(1) + "deg) rotateZ(" + r.toFixed(1) + "deg)";
    cube.classList.toggle("tilt-warn", tiltDeg >= 25 && tiltDeg < 45);
    cube.classList.toggle("tilt-crit", tiltDeg >= 45);
  }
  // cinematic ground shadow reacts to tilt
  const sh = $("carShadow");
  if (sh) {
    const t = Math.min(1, tiltDeg / 45);
    sh.style.transform = "translateX(-50%) scale(" + (1 + t * 0.45).toFixed(2) + "," + (1 + t * 0.2).toFixed(2) + ")";
    sh.style.opacity = (0.9 - t * 0.35).toFixed(2);
  }
  renderSensorStatus(d);
  checkImuSafety(d);
}

function renderSensorStatus(d) {
  const dot = (id, ok, txt) => {
    const e = $(id);
    if (e) { e.innerHTML = "<i></i>" + txt; e.classList.toggle("off", !ok); }
  };
  dot("fs-esp", GuardXState.online, GuardXState.online ? "CONNECTED" : "OFFLINE");
  const mpu = [d.accelX, d.accelY, d.accelZ].every(isFinite);
  dot("fs-mpu", mpu, mpu ? "CONNECTED" : "NO DATA");
  dot("fs-gps", !!d.gpsFix, d.gpsFix ? "LOCKED" : "SEARCHING");
  const dht = isFinite(d.temperature);
  dot("fs-dht", dht, dht ? "CONNECTED" : "NO DATA");
}

// Tilt / crash safety: warn → limit motors → auto e-stop on rollover risk
const TILT_WARN = 25, TILT_CRIT = 45, CRASH_G = 2.5;
const tiltLatch = { warn: false, crit: false, crashT: 0 };
function checkImuSafety(d) {
  const tilt = Math.hypot(isFinite(d.roll) ? d.roll : 0, isFinite(d.pitch) ? d.pitch : 0);
  const gmag = Math.hypot(d.accelX, d.accelY, d.accelZ);
  const now = Date.now();
  if (gmag > CRASH_G && now - tiltLatch.crashT > 8000) {
    tiltLatch.crashT = now;
    if (typeof addLog === "function") addLog("💥 CRASH DETECTED (" + gmag.toFixed(1) + "g impact)", "alarm");
    if (typeof toast === "function") toast("Crash detected!", "err");
  }
  const crashing = now - tiltLatch.crashT < 5000;
  if (tilt >= TILT_CRIT && !tiltLatch.crit) {
    tiltLatch.crit = true;
    if (GuardXState.online) {
      if (typeof addLog === "function") addLog("⚠️ ROLLOVER RISK — automatic emergency stop", "alarm");
      if (typeof emergencyStop === "function") emergencyStop();
    } else if (typeof addLog === "function") {
      addLog("⚠️ ROLLOVER RISK (demo — live rover would auto e-stop)", "alarm");
    }
  } else if (tilt < 30) { tiltLatch.crit = false; }
  if (tilt >= TILT_WARN && !tiltLatch.warn) {
    tiltLatch.warn = true;
    if (typeof addLog === "function") addLog("⚠️ HIGH TILT " + tilt.toFixed(0) + "° — motors limited", "warn");
  } else if (tilt < 20) { tiltLatch.warn = false; }
  let limit = 100, txt = "✅ LEVEL", cls = "decision";
  if (tiltLatch.crit || tilt >= TILT_CRIT) { limit = 0; txt = "🔴 ROLLOVER RISK"; cls += " danger"; }
  else if (tilt >= TILT_WARN) { limit = 50; txt = "🟡 HIGH TILT"; cls += " caution"; }
  if (crashing) { txt += " • 💥 CRASH"; cls += " danger"; limit = 0; }
  const badge = $("tilt-state");
  if (badge) { badge.textContent = txt; badge.className = cls; }
  const mb = $("motor-safety-bar");
  if (mb) mb.style.width = limit + "%";
  setT("motor-safety-val", limit + "%");
}

/* ---------------- LIVE GRAPHS (dependency-free canvas) ---------------- */
const IMU_HIST = 120;
const imuHist = { ax: [], ay: [], az: [], gx: [], gy: [], gz: [], roll: [], pitch: [] };
let lastSampleT = 0, sampleHz = 0;
function pushImuSample(d) {
  const now = (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
  if (lastSampleT) {
    const dt = (now - lastSampleT) / 1000;
    if (dt > 0.005) sampleHz = sampleHz * 0.8 + (1 / dt) * 0.2;
  }
  lastSampleT = now;
  const push = (k, v) => { const a = imuHist[k]; a.push(v); if (a.length > IMU_HIST) a.shift(); };
  push("ax", d.accelX); push("ay", d.accelY); push("az", d.accelZ);
  push("gx", d.gyroX); push("gy", d.gyroY); push("gz", d.gyroZ);
  push("roll", d.roll); push("pitch", d.pitch);
  drawGraphs();
  setT("sample-rate", sampleHz > 1 ? Math.min(99, Math.round(sampleHz)) + " Hz" : "—");
}
function drawTrace(cv, series, maxAbs, unit) {
  if (!cv || !cv.getContext) return;
  const ctx = cv.getContext("2d");
  const W = cv.width, H = cv.height;
  ctx.fillStyle = "#0a1322"; ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = "rgba(255,255,255,.12)"; ctx.lineWidth = 1;
  [0.5, 0.12, 0.88].forEach((f) => { ctx.beginPath(); ctx.moveTo(0, H * f); ctx.lineTo(W, H * f); ctx.stroke(); });
  ctx.fillStyle = "#8aa0bd"; ctx.font = "11px monospace";
  ctx.fillText("+" + maxAbs + unit, 5, 13);
  ctx.fillText("-" + maxAbs + unit, 5, H - 5);
  let lx = W - 8;
  series.forEach(([key, label, color]) => {
    const a = imuHist[key];
    ctx.strokeStyle = color; ctx.lineWidth = 1.6;
    ctx.beginPath();
    a.forEach((v, i) => {
      const x = (i / (IMU_HIST - 1)) * W;
      const y = H / 2 - (Math.max(-maxAbs, Math.min(maxAbs, v)) / maxAbs) * (H / 2 - 8);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.fillText(label, lx - ctx.measureText(label).width, 13);
    lx -= ctx.measureText(label).width + 10;
  });
}
function drawGraphs() {
  const C = { X: "#00e5ff", Y: "#00ff88", Z: "#ffaa00" };
  drawTrace($("graph-accel"), [["ax", "X", C.X], ["ay", "Y", C.Y], ["az", "Z", C.Z]], 2, "g");
  drawTrace($("graph-gyro"), [["gx", "X", C.X], ["gy", "Y", C.Y], ["gz", "Z", C.Z]], 100, "°/s");
  drawTrace($("graph-tilt"), [["roll", "Roll", C.Y], ["pitch", "Pitch", C.Z]], 90, "°");
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
  // IMU motion: gentle wander + periodic HIGH-TILT demo event + rare crash blip
  let roll = 8 * Math.sin(s.t / 9) + (Math.random() - 0.5) * 2;
  let pitch = 6 * Math.sin(s.t / 13 + 1) + (Math.random() - 0.5) * 2;
  if (s.t > 10 && (s.t % 70) < 4) { roll += 32; pitch += 8; } // tilt demo → motor limit warning
  const yaw = (s.t * 3) % 360;
  let az = 0.95 + Math.random() * 0.08;
  if (s.t % 97 === 0) az = 2.8; // crash spike demo (1 poll)
  return {
    front: Math.round(s.front), left: Math.round(s.left), right: Math.round(s.right),
    temperature: +s.temp.toFixed(1), humidity: +s.hum.toFixed(0),
    accelX: +(Math.random() * 0.1 - 0.05 + roll * 0.004).toFixed(2),
    accelY: +(Math.random() * 0.1 - 0.05 + pitch * 0.004).toFixed(2),
    accelZ: +az.toFixed(2),
    gyroX: +((Math.random() - 0.5) * 6).toFixed(1),
    gyroY: +((Math.random() - 0.5) * 6).toFixed(1),
    gyroZ: +(3 + (Math.random() - 0.5) * 4).toFixed(1),
    roll: +roll.toFixed(1), pitch: +pitch.toFixed(1), yaw: +yaw.toFixed(0),
    mpuTemp: +(32 + Math.sin(s.t / 25) * 1.2).toFixed(1),
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
  fenceLine = L.polyline([], { color: "#ff2d55", weight: 2, dashArray: "5 5" }).addTo(map);
  fencePoly = L.polygon([], { color: "#ff2d55", weight: 2, dashArray: "6 4", fillColor: "#ff2d55", fillOpacity: 0.15 }).addTo(map);
  map.on("click", onFenceMapClick);
  setT("map-src-tag", tileUrl.includes("openstreetmap") ? "OSM • NO KEY" : "CUSTOM SOURCE");
  restoreRoute();
  loadFence();
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
    if (last) GuardXState.distM += haversineM(last, pos);
    r.push(pos);
    if (r.length > 500) { r.shift(); } // cap stored trail
    if (routeLine) routeLine.setLatLngs(r);
    setT("gps-points", r.length);
    setT("gps-dist", fmtDist(GuardXState.distM));
    persistRoute();
  }
  roverMarker.bindPopup("GUARD-X<br>" + pos[0].toFixed(5) + ", " + pos[1].toFixed(5) + (isDemo ? "<br>DEMO DATA" : ""));
  if (GuardXState.followMap) map.setView(pos, Math.max(map.getZoom(), 16), { animate: true });
  checkFence(pos);
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

/* ---------------- MOVEMENT TRAIL (persisted per tab) ---------------- */
function haversineM(a, b) {
  const R = 6371000, toR = (d) => d * Math.PI / 180;
  const dLat = toR(b[0] - a[0]), dLon = toR(b[1] - a[1]);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toR(a[0])) * Math.cos(toR(b[0])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}
function fmtDist(m) {
  if (!isFinite(m) || m < 0) return "—";
  return m < 1000 ? Math.round(m) + " m" : (m / 1000).toFixed(2) + " km";
}
function persistRoute() {
  try { sessionStorage.setItem(SS_ROUTE, JSON.stringify(GuardXState.route.slice(-500))); } catch (e) { /* ignore */ }
}
function restoreRoute() {
  try {
    const raw = sessionStorage.getItem(SS_ROUTE);
    if (!raw) return;
    const pts = JSON.parse(raw);
    if (!Array.isArray(pts) || !pts.length) return;
    GuardXState.route = pts.filter((p) => Array.isArray(p) && isFinite(p[0]) && isFinite(p[1])).slice(-500);
    GuardXState.distM = 0;
    for (let i = 1; i < GuardXState.route.length; i++) {
      GuardXState.distM += haversineM(GuardXState.route[i - 1], GuardXState.route[i]);
    }
    if (routeLine) routeLine.setLatLngs(GuardXState.route);
    setT("gps-points", GuardXState.route.length);
    setT("gps-dist", fmtDist(GuardXState.distM));
  } catch (e) { /* ignore */ }
}
function clearStoredRoute() {
  try { sessionStorage.removeItem(SS_ROUTE); } catch (e) { /* ignore */ }
  GuardXState.distM = 0;
  setT("gps-dist", "0 m");
}

/* ---------------- LOCATION SEARCH (Nominatim, no key) ---------------- */
let suggestCtrl = null, suggestTimer = null, suggestItems = [], suggestSel = -1;

function flyToPlace(lat, lon, label, query) {
  const short = String(label || query || "").split(",").slice(0, 3).join(",");
  if (map && typeof L !== "undefined" && isFinite(lat) && isFinite(lon)) {
    if (searchMarker) map.removeLayer(searchMarker);
    searchMarker = L.marker([lat, lon]).addTo(map).bindPopup("📍 " + short).openPopup();
    map.setView([lat, lon], 17);
  }
  // stop auto-follow yanking the view back to the rover while marking elsewhere
  GuardXState.followMap = false;
  const ft = $("follow-toggle");
  if (ft) ft.checked = false;
  const resEl = $("loc-result");
  if (resEl) { resEl.classList.remove("hidden"); resEl.textContent = "📍 " + short; }
  if (typeof addLog === "function") addLog("Map jumped to: " + (query || short), "ok");
}

async function searchLocation(query) {
  const q = (query || "").trim();
  if (!q) { toast("Type a place name first", "err"); return; }
  closeSuggestions();
  const resEl = $("loc-result");
  if (resEl) { resEl.classList.remove("hidden"); resEl.textContent = "Searching…"; }
  try {
    const url = "https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&addressdetails=0&q=" + encodeURIComponent(q);
    const res = await fetch(url, { headers: { "Accept": "application/json" } });
    if (!res.ok) throw new Error("search HTTP " + res.status);
    const list = await res.json();
    if (!list || !list.length) throw new Error("no results for '" + q + "'");
    const hit = list[0];
    flyToPlace(parseFloat(hit.lat), parseFloat(hit.lon), hit.display_name, q);
    toast("Found " + q + " — auto-follow off, mark your area", "ok");
  } catch (e) {
    if (resEl) resEl.textContent = "Search failed: " + e.message;
    toast("Search: " + e.message, "err");
  }
}

async function fetchSuggestions(q) {
  q = (q || "").trim();
  const box = $("loc-suggest");
  if (q.length < 3) { closeSuggestions(); return; }
  if (suggestCtrl) suggestCtrl.abort();
  suggestCtrl = new AbortController();
  try {
    const url = "https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&addressdetails=0&q=" + encodeURIComponent(q);
    const res = await fetch(url, { signal: suggestCtrl.signal, headers: { "Accept": "application/json" } });
    if (!res.ok) throw new Error("HTTP " + res.status);
    suggestItems = (await res.json()) || [];
    suggestSel = -1;
    renderSuggestions();
  } catch (e) {
    if (e && e.name === "AbortError") return; // superseded by newer keystroke
    closeSuggestions();
  }
}
function renderSuggestions() {
  const box = $("loc-suggest"), inp = $("loc-search");
  if (!box) return;
  if (!suggestItems.length) { closeSuggestions(); return; }
  box.innerHTML = "";
  suggestItems.forEach((hit, i) => {
    const li = document.createElement("li");
    li.setAttribute("role", "option");
    const parts = String(hit.display_name || "").split(",");
    const main = document.createElement("div");
    main.textContent = parts.slice(0, 2).join(",");
    const sub = document.createElement("small");
    sub.textContent = parts.slice(2, 5).join(",");
    li.appendChild(main); li.appendChild(sub);
    if (i === suggestSel) li.classList.add("sel");
    li.addEventListener("mousedown", (e) => { e.preventDefault(); pickSuggestion(i); });
    box.appendChild(li);
  });
  box.classList.remove("hidden");
  if (inp) inp.setAttribute("aria-expanded", "true");
}
function moveSuggestion(dir) {
  if (!suggestItems.length) return false;
  suggestSel = (suggestSel + dir + suggestItems.length) % suggestItems.length;
  renderSuggestions();
  const box = $("loc-suggest");
  const sel = box && box.children[suggestSel];
  if (sel && sel.scrollIntoView) sel.scrollIntoView({ block: "nearest" });
  return true;
}
function pickSuggestion(i) {
  const hit = suggestItems[i];
  closeSuggestions();
  if (!hit) return;
  const inp = $("loc-search");
  if (inp) inp.value = String(hit.display_name || "").split(",").slice(0, 2).join(",");
  flyToPlace(parseFloat(hit.lat), parseFloat(hit.lon), hit.display_name, inp ? inp.value : "");
  toast("Pinned — auto-follow off, mark your area", "ok");
}
function closeSuggestions() {
  suggestItems = []; suggestSel = -1;
  const box = $("loc-suggest"), inp = $("loc-search");
  if (box) { box.classList.add("hidden"); box.innerHTML = ""; }
  if (inp) inp.setAttribute("aria-expanded", "false");
}
function suggestionsOpen() {
  const box = $("loc-suggest");
  return !!(box && !box.classList.contains("hidden") && suggestItems.length);
}

/* ---------------- RESTRICTED AREA / GEOFENCE ---------------- */
function pointInFence(latlon) {
  const poly = GuardXState.fence;
  if (!poly || poly.length < 3) return false;
  const x = latlon[1], y = latlon[0]; // lon, lat
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][1], yi = poly[i][0], xj = poly[j][1], yj = poly[j][0];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function renderFenceStatus() {
  const n = GuardXState.fence.length;
  const badge = $("fence-status"), st = $("fence-state"), cnt = $("fence-count");
  const finBtn = $("btn-fence-finish");
  if (cnt) cnt.textContent = n;
  if (badge) badge.style.color = "";
  if (GuardXState.marking) {
    if (badge) { badge.innerHTML = "<i></i>MARKING"; badge.classList.remove("off"); }
    if (st) st.textContent = n + " point(s) — tap map, then FINISH";
    if (finBtn) finBtn.classList.toggle("hidden", n < 3);
    const mapEl = $("gps-map");
    if (mapEl) mapEl.classList.add("marking");
    return;
  }
  const mapEl = $("gps-map");
  if (mapEl) mapEl.classList.remove("marking");
  if (finBtn) finBtn.classList.add("hidden");
  if (n < 3) {
    if (badge) { badge.innerHTML = "<i></i>NOT SET"; badge.classList.add("off"); }
    if (st) st.textContent = "—";
    return;
  }
  if (GuardXState.fenceInside) {
    if (badge) { badge.innerHTML = "<i></i>ROVER INSIDE!"; badge.classList.remove("off"); badge.style.color = "var(--red)"; }
    if (st) st.textContent = "🔴 INSIDE restricted area";
  } else {
    if (badge) { badge.innerHTML = "<i></i>ARMED"; badge.classList.remove("off"); }
    if (st) st.textContent = "🟢 Rover outside (" + n + " pts)";
  }
}
function drawFenceLayers() {
  if (fencePoly) fencePoly.setLatLngs(GuardXState.fence.length >= 3 && !GuardXState.marking ? GuardXState.fence : []);
  if (fenceLine) fenceLine.setLatLngs(GuardXState.marking ? GuardXState.fence : []);
}
function startFenceMarking() {
  GuardXState.marking = true;
  GuardXState.fence = [];
  GuardXState.fenceInside = false;
  drawFenceLayers();
  renderFenceStatus();
  // jump straight to the map so the user can tap boundary points immediately
  const mapEl = $("gps-map");
  if (mapEl && mapEl.scrollIntoView) {
    mapEl.scrollIntoView({ behavior: "smooth", block: "center" });
  }
  toast("Tap the map to drop boundary points", "ok");
  if (typeof addLog === "function") addLog("Marking restricted area — tap map", "warn");
}
function onFenceMapClick(e) {
  if (!GuardXState.marking || !e || !e.latlng) return;
  GuardXState.fence.push([+e.latlng.lat.toFixed(6), +e.latlng.lng.toFixed(6)]);
  drawFenceLayers();
  renderFenceStatus();
}
function finishFence() {
  if (GuardXState.fence.length < 3) { toast("Need at least 3 points", "err"); return; }
  GuardXState.marking = false;
  try { localStorage.setItem(LS_FENCE, JSON.stringify(GuardXState.fence)); } catch (e) { /* ignore */ }
  drawFenceLayers();
  // evaluate current rover position immediately
  if (lastGps) GuardXState.fenceInside = pointInFence(lastGps);
  renderFenceStatus();
  if (typeof addLog === "function") addLog("Restricted area armed (" + GuardXState.fence.length + " pts)", "ok");
  toast("Restricted area armed", "ok");
}
function clearFence() {
  GuardXState.marking = false;
  GuardXState.fence = [];
  GuardXState.fenceInside = false;
  try { localStorage.removeItem(LS_FENCE); } catch (e) { /* ignore */ }
  drawFenceLayers();
  renderFenceStatus();
  if (typeof addLog === "function") addLog("Restricted area cleared", "warn");
}
function loadFence() {
  try {
    const raw = localStorage.getItem(LS_FENCE);
    if (!raw) { renderFenceStatus(); return; }
    const pts = JSON.parse(raw);
    if (Array.isArray(pts) && pts.length >= 3) GuardXState.fence = pts;
  } catch (e) { /* ignore */ }
  drawFenceLayers();
  renderFenceStatus();
}
function checkFence(pos) {
  if (GuardXState.fence.length < 3 || !pos) return;
  const inside = pointInFence(pos);
  if (inside !== GuardXState.fenceInside) {
    GuardXState.fenceInside = inside;
    renderFenceStatus();
    if (inside) {
      if (typeof addLog === "function") addLog("⛔ ROVER ENTERED RESTRICTED AREA", "alarm");
      toast("⛔ Rover entered restricted area!", "err");
    } else {
      if (typeof addLog === "function") addLog("Rover exited restricted area", "ok");
      toast("Rover exited restricted area", "ok");
    }
  }
}
