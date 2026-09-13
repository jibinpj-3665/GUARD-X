/* ============================================================
   GUARD-X APP WIRING (js/app.js) — init, inputs, polling loop
   Multi-page safe: every binding tolerates missing elements,
   so each HTML page only includes the panels it needs.
   ============================================================ */
(function () {
  "use strict";

  // Bind only if the element exists on this page. Returns element or null.
  function on(id, ev, fn) {
    const e = document.getElementById(id);
    if (e) e.addEventListener(ev, fn);
    return e;
  }
  function get(id) { return document.getElementById(id); }

  const HARDWARE = [
    ["ESP32 DevKit", "Wi-Fi MCU • web server • sensor hub", "CORE"],
    ["L298N Driver", "Dual H-bridge for 4WD motors", "READY"],
    ["4× DC Gear Motors", "4WD mobility + torque", "READY"],
    ["3× HC-SR04", "Front / left / right distance", "LIVE"],
    ["MPU6050", "Accel + gyro motion sensing", "LIVE"],
    ["NEO-6M GPS", "Lat/lon fix + satellites", "LIVE"],
    ["DHT11", "Temperature + humidity", "LIVE"],
    ["0.96\" OLED", "Onboard status display", "READY"],
    ["Vibration Sensor", "Intrusion / tamper detect", "ARMED"],
    ["SG90 Servo", "Ultrasonic sweep scanner", "READY"],
    ["WS2812B LED", "Status lighting", "READY"],
    ["Buzzer", "Intrusion + alert tone", "ARMED"],
    ["Battery System", "Power + level monitor", "LIVE"]
  ];

  function renderHardware() {
    const g = get("hw-grid");
    if (!g) return;
    g.innerHTML = "";
    HARDWARE.forEach(([name, purpose, st]) => {
      const d = document.createElement("div");
      d.className = "hw";
      d.innerHTML = "<strong></strong><small></small><span class='st'></span>";
      d.querySelector("strong").textContent = name;
      d.querySelector("small").textContent = purpose;
      d.querySelector(".st").textContent = "● " + st;
      g.appendChild(d);
    });
  }

  /* ---------- polling ---------- */
  let polling = false;
  async function pollOnce() {
    if (polling) return;
    polling = true;
    try {
      const data = await fetchSensorData();
      renderTelemetry(data);
      updateConnectionUI();
    } catch (e) {
      updateConnectionUI();
      const lp = get("last-poll");
      if (lp) lp.textContent = "last poll failed: " + e.message;
    } finally {
      polling = false;
    }
  }

  /* ---------- drive buttons (click + hold-to-drive) ---------- */
  function bindDrive() {
    document.querySelectorAll(".dbtn").forEach((btn) => {
      const cmd = btn.dataset.cmd;
      btn.addEventListener("click", () => sendCommand(cmd));
      // hold-to-drive on touch/mouse: release sends STOP (except STOP itself)
      if (cmd !== "stop") {
        btn.addEventListener("pointerdown", (e) => {
          e.preventDefault();
          btn.classList.add("active");
          sendCommand(cmd);
        });
        ["pointerup", "pointerleave", "pointercancel"].forEach((ev) =>
          btn.addEventListener(ev, () => {
            if (!btn.classList.contains("active")) return;
            btn.classList.remove("active");
            sendCommand("stop");
          })
        );
      }
    });
  }

  function bindKeyboard() {
    const keymap = { w: "forward", s: "backward", a: "left", d: "right" };
    document.addEventListener("keydown", (e) => {
      const tag = (document.activeElement && document.activeElement.tagName) || "";
      if (tag === "INPUT" || tag === "TEXTAREA") return; // don't hijack typing
      if (e.code === "Space") { e.preventDefault(); emergencyStop(); return; }
      const k = (e.key || "").toLowerCase();
      if (keymap[k] && !e.repeat) sendCommand(keymap[k]);
    });
  }

  function bindUI() {
    const demo = on("demo-toggle", "change", () => {
      GuardXState.demoMode = demo.checked;
      if (demo.checked) resetDemo();
      addLog(demo.checked ? "DEMO MODE ENABLED — simulated data" : "DEMO MODE OFF — live ESP32 only", demo.checked ? "warn" : "ok");
      updateConnectionUI();
      pollOnce();
    });
    if (demo) GuardXState.demoMode = demo.checked;

    on("btn-connect", "click", async () => {
      addLog("Probing ESP32 @ " + getBaseUrl() + " …");
      const ok = await probeConnection();
      addLog(ok ? "ESP32 CONNECTED — live telemetry" : "ESP32 UNREACHABLE — check IP / AP join", ok ? "ok" : "alarm");
      toast(ok ? "ESP32 online" : "ESP32 offline — demo continues", ok ? "ok" : "err");
      pollOnce();
    });
    on("btn-disconnect", "click", () => {
      setOnline(false);
      addLog("Link closed by operator", "warn");
    });
    on("btn-poll-now", "click", pollOnce);
    on("esp-ip", "change", updateConnectionUI);

    on("mode-manual", "click", () => setMode("manual"));
    on("mode-auto", "click", () => setMode("auto"));

    const slider = get("speed-slider");
    if (slider) {
      const paintSpeed = () => {
        const pct = Math.round((slider.value / 255) * 100) + "%";
        const p1 = get("speed-pct"), p2 = get("speed-num");
        if (p1) p1.textContent = pct;
        if (p2) p2.textContent = slider.value;
      };
      slider.addEventListener("input", paintSpeed);
      slider.addEventListener("change", () => setSpeed(slider.value));
      paintSpeed();
    }
    on("btn-speed-apply", "click", () => {
      const v = get("speed-slider");
      if (!v) return;
      setSpeed(v.value);
      addLog("Speed → " + v.value + "/255");
    });

    const estop = (e) => { if (e) e.preventDefault(); emergencyStop(); };
    on("btn-emergency", "click", estop);
    on("btn-emergency-top", "click", estop);
    document.querySelectorAll(".js-estop").forEach((b) => b.addEventListener("click", estop));

    on("btn-auto-start", "click", async () => {
      addLog("Autonomous patrol requested");
      await startAutonomous();
    });
    on("btn-auto-stop", "click", async () => {
      addLog("Autonomous patrol stopped by operator", "warn");
      await stopAutonomous();
      await sendCommand("stop");
    });

    on("btn-ack", "click", () => {
      GuardXState.acknowledged = true;
      document.body.classList.remove("alarm");
      addLog("Alert acknowledged by operator", "ok");
      toast("Alert acknowledged", "ok");
    });
    on("btn-clear-log", "click", () => {
      const ul = get("event-log");
      if (ul) ul.innerHTML = "";
      addLog("Log cleared");
    });

    // map controls
    on("btn-center", "click", () => {
      if (typeof map !== "undefined" && map && typeof roverMarker !== "undefined" && roverMarker) {
        map.setView(roverMarker.getLatLng(), 17);
      }
    });
    on("btn-clear-route", "click", () => {
      GuardXState.route = [];
      if (typeof routeLine !== "undefined" && routeLine) routeLine.setLatLngs([]);
      if (typeof clearRoadGeometry === "function") clearRoadGeometry();
      if (typeof clearStoredRoute === "function") clearStoredRoute();
      const gp = get("gps-points");
      if (gp) gp.textContent = "0";
      addLog("Route cleared");
    });
    on("follow-toggle", "change", (e) => {
      GuardXState.followMap = e.target.checked;
    });
    on("btn-apply-map", "click", refreshMapSource);
    on("btn-osm-reset", "click", () => {
      const k = get("map-key"), t = get("map-tile");
      if (k) k.value = "";
      if (t) t.value = GUARDX_CONFIG.MAP_TILE_URL_DEFAULT;
      refreshMapSource();
    });

    // ---- API keys (bring your own) ----
    const togglePw = (inputId, btnId) => {
      const inp = get(inputId), btn = get(btnId);
      if (!inp || !btn) return;
      btn.addEventListener("click", () => {
        const show = inp.type === "password";
        inp.type = show ? "text" : "password";
        btn.textContent = show ? "👁" : "🚫👁";
      });
    };
    togglePw("ors-key", "btn-toggle-ors");
    togglePw("gemini-key", "btn-toggle-gemini");
    ["ors-key", "gemini-key"].forEach((id) => on(id, "input", () => renderApiKeyStatus()));
    on("btn-save-keys", "click", () => {
      const s = saveApiKeys();
      addLog("API keys saved — ORS: " + (s.ors ? "set" : "empty") + ", Gemini: " + (s.gemini ? "set" : "empty"), "ok");
      toast("Keys saved locally", "ok");
    });
    on("btn-clear-keys", "click", () => {
      const o = get("ors-key"), g = get("gemini-key");
      if (o) o.value = "";
      if (g) g.value = "";
      saveApiKeys();
      addLog("API keys cleared from this browser", "warn");
    });

    // ---- ORS road geometry ----
    on("btn-road-route", "click", async () => {
      const st = get("ors-road-status");
      try {
        if (GuardXState.route.length < 2) { toast("Need 2+ GPS points first", "err"); return; }
        if (st) st.textContent = "Road geometry: requesting ORS…";
        const road = await fetchRoadGeometry(GuardXState.route);
        drawRoadGeometry(road);
        addLog("ORS road route drawn (" + road.length + " pts)", "ok");
      } catch (e) {
        if (st) st.textContent = "Road geometry failed: " + e.message;
        addLog("ORS failed — " + e.message, "alarm");
        toast("ORS: " + e.message, "err");
      }
    });

    // ---- Restricted area / geofence ----
    on("btn-fence-mark", "click", () => {
      if (typeof startFenceMarking === "function") startFenceMarking();
      else toast("Open the GPS page to mark an area", "err");
    });
    on("btn-fence-finish", "click", () => { if (typeof finishFence === "function") finishFence(); });
    on("btn-fence-clear", "click", () => { if (typeof clearFence === "function") clearFence(); });

    // ---- Gemini AI analysis ----
    on("btn-ai-analyze", "click", async () => {
      const badge = get("ai-status");
      try {
        setAiOutput("Analyzing latest telemetry with Gemini…", true);
        if (badge) { badge.textContent = "THINKING"; badge.className = "badge warn"; }
        const text = await analyzeWithGemini();
        setAiOutput(text, false);
        if (badge) { badge.textContent = "DONE"; badge.className = "badge ok"; }
        addLog("Gemini analysis complete", "ok");
      } catch (e) {
        setAiOutput("AI failed: " + e.message + "\n\nTip: save a Gemini key above (aistudio.google.com).", false);
        if (badge) { badge.textContent = "ERROR"; badge.className = "badge warn"; }
        addLog("Gemini failed — " + e.message, "alarm");
      }
    });
    on("btn-ai-clear", "click", () => {
      setAiOutput("Press ANALYZE WITH AI — needs a Gemini key above.", false);
    });
  }

  /* ---------- init ---------- */
  function init() {
    renderHardware();
    resetDemo();
    bindUI();
    bindDrive();
    bindKeyboard();
    if (get("gps-map")) initMap();
    loadApiKeys();
    updateConnectionUI();
    renderMode(GuardXState.mode || "MANUAL");

    const hasLog = !!get("event-log");
    if (hasLog) {
      addLog("SYSTEM INITIALIZED", "ok");
      addLog("Dashboard ready — " + (GuardXState.demoMode ? "DEMO MODE (simulated data)" : "live mode"), "warn");
    }

    pollOnce();
    setInterval(pollOnce, GUARDX_CONFIG.POLL_INTERVAL_MS);
    const pl = get("poll-label");
    if (pl) pl.textContent = (GUARDX_CONFIG.POLL_INTERVAL_MS / 1000).toFixed(1);
  }

  document.addEventListener("DOMContentLoaded", init);
})();
