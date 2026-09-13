/* ============================================================
   GUARD-X APP WIRING (js/app.js) — init, inputs, polling loop
   ============================================================ */
(function () {
  "use strict";

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
    const g = document.getElementById("hw-grid");
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
      const lp = document.getElementById("last-poll");
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
      const k = e.key.toLowerCase();
      if (keymap[k] && !e.repeat) sendCommand(keymap[k]);
    });
  }

  function bindUI() {
    const demo = document.getElementById("demo-toggle");
    demo.addEventListener("change", () => {
      GuardXState.demoMode = demo.checked;
      if (demo.checked) resetDemo();
      addLog(demo.checked ? "DEMO MODE ENABLED — simulated data" : "DEMO MODE OFF — live ESP32 only", demo.checked ? "warn" : "ok");
      updateConnectionUI();
      pollOnce();
    });
    GuardXState.demoMode = demo.checked;

    document.getElementById("btn-connect").addEventListener("click", async () => {
      addLog("Probing ESP32 @ " + getBaseUrl() + " …");
      const ok = await probeConnection();
      addLog(ok ? "ESP32 CONNECTED — live telemetry" : "ESP32 UNREACHABLE — check IP / AP join", ok ? "ok" : "alarm");
      toast(ok ? "ESP32 online" : "ESP32 offline — demo continues", ok ? "ok" : "err");
      pollOnce();
    });
    document.getElementById("btn-disconnect").addEventListener("click", () => {
      setOnline(false);
      addLog("Link closed by operator", "warn");
    });
    document.getElementById("btn-poll-now").addEventListener("click", pollOnce);
    document.getElementById("esp-ip").addEventListener("change", updateConnectionUI);

    document.getElementById("mode-manual").addEventListener("click", () => setMode("manual"));
    document.getElementById("mode-auto").addEventListener("click", () => setMode("auto"));

    const slider = document.getElementById("speed-slider");
    const paintSpeed = () => {
      document.getElementById("speed-pct").textContent = Math.round((slider.value / 255) * 100) + "%";
      document.getElementById("speed-num").textContent = slider.value;
    };
    slider.addEventListener("input", paintSpeed);
    slider.addEventListener("change", () => setSpeed(slider.value));
    document.getElementById("btn-speed-apply").addEventListener("click", () => {
      setSpeed(slider.value);
      addLog("Speed → " + slider.value + "/255");
    });
    paintSpeed();

    const estop = (e) => { if (e) e.preventDefault(); emergencyStop(); };
    document.getElementById("btn-emergency").addEventListener("click", estop);
    document.getElementById("btn-emergency-top").addEventListener("click", estop);

    document.getElementById("btn-auto-start").addEventListener("click", async () => {
      addLog("Autonomous patrol requested");
      await startAutonomous();
    });
    document.getElementById("btn-auto-stop").addEventListener("click", async () => {
      addLog("Autonomous patrol stopped by operator", "warn");
      await stopAutonomous();
      await sendCommand("stop");
    });

    document.getElementById("btn-ack").addEventListener("click", () => {
      GuardXState.acknowledged = true;
      document.body.classList.remove("alarm");
      addLog("Alert acknowledged by operator", "ok");
      toast("Alert acknowledged", "ok");
    });
    document.getElementById("btn-clear-log").addEventListener("click", () => {
      document.getElementById("event-log").innerHTML = "";
      addLog("Log cleared");
    });

    // map controls
    document.getElementById("btn-center").addEventListener("click", () => {
      if (map && roverMarker) { map.setView(roverMarker.getLatLng(), 17); }
    });
    document.getElementById("btn-clear-route").addEventListener("click", () => {
      GuardXState.route = [];
      if (routeLine) routeLine.setLatLngs([]);
      if (typeof clearRoadGeometry === "function") clearRoadGeometry();
      document.getElementById("gps-points").textContent = "0";
      addLog("Route cleared");
    });
    document.getElementById("follow-toggle").addEventListener("change", (e) => {
      GuardXState.followMap = e.target.checked;
    });
    document.getElementById("btn-apply-map").addEventListener("click", refreshMapSource);
    document.getElementById("btn-osm-reset").addEventListener("click", () => {
      document.getElementById("map-key").value = "";
      document.getElementById("map-tile").value = GUARDX_CONFIG.MAP_TILE_URL_DEFAULT;
      refreshMapSource();
    });

    // ---- API keys (bring your own) ----
    const togglePw = (inputId, btnId) => {
      const inp = document.getElementById(inputId);
      const btn = document.getElementById(btnId);
      if (!inp || !btn) return;
      btn.addEventListener("click", () => {
        const show = inp.type === "password";
        inp.type = show ? "text" : "password";
        btn.textContent = show ? "👁" : "🚫👁";
      });
    };
    togglePw("ors-key", "btn-toggle-ors");
    togglePw("gemini-key", "btn-toggle-gemini");
    ["ors-key", "gemini-key"].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.addEventListener("input", () => renderApiKeyStatus());
    });
    document.getElementById("btn-save-keys").addEventListener("click", () => {
      const s = saveApiKeys();
      addLog("API keys saved — ORS: " + (s.ors ? "set" : "empty") + ", Gemini: " + (s.gemini ? "set" : "empty"), "ok");
      toast("Keys saved locally", "ok");
    });
    document.getElementById("btn-clear-keys").addEventListener("click", () => {
      document.getElementById("ors-key").value = "";
      document.getElementById("gemini-key").value = "";
      saveApiKeys();
      addLog("API keys cleared from this browser", "warn");
    });

    // ---- ORS road geometry ----
    document.getElementById("btn-road-route").addEventListener("click", async () => {
      const st = document.getElementById("ors-road-status");
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

    // ---- Gemini AI analysis ----
    document.getElementById("btn-ai-analyze").addEventListener("click", async () => {
      const out = document.getElementById("ai-output");
      const badge = document.getElementById("ai-status");
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
    document.getElementById("btn-ai-clear").addEventListener("click", () => {
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
    initMap();
    loadApiKeys();
    updateConnectionUI();
    renderMode("MANUAL");

    addLog("SYSTEM INITIALIZED", "ok");
    addLog("Dashboard ready — " + (GuardXState.demoMode ? "DEMO MODE (simulated data)" : "live mode"), "warn");
    addLog("GPS SEARCHING … (awaiting fix)");
    addLog("Tip: set ESP32 IP, press CONNECT for live data");

    pollOnce();
    setInterval(pollOnce, GUARDX_CONFIG.POLL_INTERVAL_MS);
    document.getElementById("poll-label").textContent = (GUARDX_CONFIG.POLL_INTERVAL_MS / 1000).toFixed(1);
  }

  document.addEventListener("DOMContentLoaded", init);
})();
