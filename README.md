# GUARD-X — Autonomous Multi-Sensor Security Rover

ESP32-based 4WD autonomous security and environmental monitoring rover with a real-time
web control dashboard (HTML + CSS + vanilla JavaScript, no frameworks).

Live dashboard: open `index.html` (or serve the folder) — works on desktop, tablet and mobile.
Demo mode is ON by default, so the full UI animates with simulated data when no ESP32 is connected.

## Features

- **Robot control dashboard** — connection state, mode, battery, speed, direction, system status
- **IMU & telemetry lab** — Roll/Pitch/Yaw, accel/gyro XYZ, MPU temperature, per-sensor link status
- **Live 3D orientation** — cinematic dependency-free CSS-3D rover (chassis, glass cabin, wheels, sensor mast, headlights) that tilts/rotates with the MPU6050, with showroom floor, dynamic shadow and tilt-reactive lighting; works offline from the ESP32 AP
- **Live graphs** — accel / gyro / tilt ring-buffer charts (~20–50 Hz over WebSocket, per-poll over HTTP)
- **Tilt & crash safety** — HIGH TILT motor limiting, automatic e-stop on rollover risk, impact detection
- **WebSocket stream** — ESP32 pushes to `ws://<ip>:81/` when available, HTTP poll is the automatic fallback
- **Manual drive** — D-pad (click + hold-to-drive), speed slider 0–255, emergency STOP, keyboard (`W/A/S/D`, `Space`)
- **Autonomous patrol** — start/stop, live decision display (path clear / obstacle / turning / intrusion)
- **Multi-sensor telemetry** — 3x HC-SR04 distances, DHT11 temp/humidity, MPU6050 accel, GPS, vibration
- **GPS tracking** — Leaflet + OpenStreetMap (no key needed), rover marker, travelled-path polyline, heading, auto-follow
- **Real road geometry (optional)** — OpenRouteService key snaps the track to real roads
- **Live AI analysis (optional)** — Google Gemini key gives a short safety assessment of current telemetry
- **Security panel** — vibration intrusion detection, buzzer state, flashing alarm UI, acknowledge flow
- **Event log, OLED mirror, system architecture diagram, hardware manifest**

## Quick start

```bash
cd guard-x
python -m http.server 8000
# open http://localhost:8000
```

1. Keep **DEMO** ON to explore with simulated data.
2. For live hardware: join the ESP32 AP (default `192.168.4.1`), set the IP in the dashboard, press **CONNECT**.
3. Turn DEMO OFF for live-only operation (movement commands are blocked while offline).

## File structure

```
index.html        home: status, sensors, motion + ESP32 connect
control.html      manual drive, speed, safety
autonomous.html   auto patrol, surroundings, rover visualization
imu.html          MPU6050: 3D orientation, graphs, tilt/crash safety, WS stream
gps.html          GPS map (Leaflet), road route, tile key
keys.html         optional ORS + Gemini keys, AI analysis
security.html     intrusion panel, event log, OLED mirror
system.html       architecture diagram
about.html        mission, applications, hardware manifest
css/style.css     dark cyber-industrial theme, responsive + mobile bottom nav
js/api.js         ESP32 + map/key config, command + sensor + ORS + Gemini APIs
js/dashboard.js   UI rendering, demo simulator, Leaflet map
js/app.js         wiring, keyboard, polling loop (multi-page safe)
assets/           static assets
```

Each page is standalone for easy phone use: a fixed bottom nav (mobile)
plus prev/next pager links connect all 8 pages. Live demo:
https://jibinpj-3665.github.io/GUARD-X/

## ESP32 HTTP API

All requests use `ESP32_IP` in `js/api.js` (default `192.168.4.1`):

| Action            | Request                  |
|-------------------|--------------------------|
| Forward / back    | `GET /forward`, `/backward` |
| Left / right      | `GET /left`, `/right`    |
| Stop (incl. Space)| `GET /stop`              |
| Speed 0–255       | `GET /speed?value=150`   |
| Mode              | `GET /mode?value=auto` or `manual` |
| Telemetry (poll)  | `GET /status` (JSON below) |
| Live stream (push)| `ws://<esp-ip>:81/` (JSON frames, same shape — ideal for 20–50 Hz IMU) |

The dashboard tries the WebSocket after CONNECT and falls back to HTTP polling automatically.

Expected `/status` JSON:

```json
{
  "front": 82, "left": 65, "right": 71,
  "temperature": 28.4, "humidity": 64,
  "accelX": 0.02, "accelY": -0.04, "accelZ": 0.98,
  "gyroX": 0.5, "gyroY": -0.3, "gyroZ": 1.2,
  "roll": 2.1, "pitch": -1.2, "yaw": 87.5, "mpuTemp": 32.4,
  "latitude": 10.52, "longitude": 76.21,
  "satellites": 7, "gpsFix": true,
  "vibration": false, "battery": 82,
  "mode": "MANUAL", "speed": 180, "direction": "STOP"
}
```

`roll`/`pitch` are optional — the dashboard estimates tilt from the accelerometer
when fusion values are absent. `yaw` needs gyro/mag fusion (shows — otherwise).

## Optional API keys (bring your own)

No keys required — OSM map + dashboard + demo mode all work without them.
Keys are stored only in the browser's `localStorage`, never in the repo.

| Key | Purpose | Free key |
|-----|---------|----------|
| OpenRouteService | Snap travelled path to real road geometry (`ROAD ROUTE` button) | openrouteservice.org |
| Google Gemini | Live AI safety analysis of current telemetry | aistudio.google.com |
| Map tile key | Only if you switch from OSM to a keyed tile provider | — |

Set them in `js/api.js` (`GUARDX_CONFIG.ORS_KEY` / `GEMINI_KEY`) or paste them in the
dashboard's **API KEYS** panel → **SAVE KEYS**.

## Hardware

ESP32 DevKit, L298N, 4x DC gear motors, 3x HC-SR04, MPU6050, NEO-6M GPS, DHT11,
0.96" OLED, vibration sensor, SG90 servo, WS2812B, buzzer, battery system.
See the in-dashboard **HARDWARE MANIFEST** for roles.

## Safety

- Emergency STOP (`Space` / red buttons) sends `/stop` immediately.
- Link loss flips status to OFFLINE, blocks movement commands, and logs a warning.
- Demo data is always labelled `DEMO MODE — SIMULATED DATA`, never mixed with live readings.
