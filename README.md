# Drone Pathika — Mission Planner & Live Flight Dashboard

> A browser-based drone mission planner and Ground Control Station (GCS) featuring real-time MAVLink/SITL hardware telemetry streaming, built-in physics simulation, drag-and-drop waypoint routing, live weather integration, Indian DGCA no-fly zone monitoring, and CSV telemetry data logging.

![Status](https://img.shields.io/badge/Status-Active-00e676?style=flat-square)
![License](https://img.shields.io/badge/License-MIT-58a6ff?style=flat-square)
![MAVLink](https://img.shields.io/badge/MAVLink-Supported-7952b3?style=flat-square)
![API Keys](https://img.shields.io/badge/API%20Keys-Not%20Required-2ea043?style=flat-square)

---

## 📋 Table of Contents

- [Overview](#overview)
- [Key Features](#key-features)
- [Architecture](#architecture)
- [Tech Stack](#tech-stack)
- [Getting Started](#getting-started)
- [Hardware & SITL Telemetry Bridge (`bridge.py`)](#hardware--sitl-telemetry-bridge-bridgepy)
- [File Structure](#file-structure)
- [Controls & Operations](#controls--operations)
- [Configuration](#configuration)
- [Data Sources](#data-sources)
- [Future Advancements](#future-advancements)
- [License & Authors](#license--authors)

---

## Overview

**Drone Pathika** is an engineering Ground Control Station (GCS) and mission planning platform designed for both simulated and physical drones. It enables operators to plan complex waypoint routes on an interactive map, inspect pre-flight flight dynamics, and monitor live telemetry in two distinct modes:

1. **Autonomous Simulator Mode**: Runs high-fidelity kinematic and aerodynamic calculations factoring in live meteorological wind vectors, battery Peukert drain with internal resistance voltage sag, and automated Return-to-Home (RTH) on critical battery.
2. **MAVLink / SITL Hardware Bridge Mode**: Connects directly via WebSocket (`ws://localhost:8765`) to real flight controllers (Pixhawk, ArduPilot, PX4) or ArduPilot SITL. Decodes incoming aerospace MAVLink packets (`HEARTBEAT`, `GLOBAL_POSITION_INT`, `SYS_STATUS`, `VFR_HUD`, `ATTITUDE`) to display true pack voltage, motor current draw, armed status, flight mode, and real-time positioning.

---

## Key Features

### 🗺️ Interactive Waypoint Mission Planning
- **Click-to-Add Waypoints**: Place sequential navigation waypoints with automatic numbered visual markers.
- **Draggable Waypoints**: Click and drag any waypoint directly on the map to modify flight paths dynamically.
- **Individual Waypoint Deletion**: Click on any waypoint marker to inspect exact coordinates and delete it via popup.
- **Checkpoint Resume**: Completed a mission leg? Add new waypoints and continue from the destination without restarting from waypoint 1.
- **Mission Export & Import**: Save your waypoint routes to `.json` files or import existing plans instantly.

### 🔌 Physical Drone & SITL Integration (MAVLink Bridge)
- **Real-Time WebSocket Ingestion**: Streams decoded aerospace telemetry at 10 Hz from `bridge.py`.
- **Flight Controller Monitoring**:
  - **Flight Modes**: `STABILIZE`, `GUIDED`, `AUTO`, `LOITER`, `RTL`, `LAND`.
  - **Arming Status**: Safety armed / disarmed indicator with toggle button.
  - **True Battery Telemetry**: Pack voltage ($V$) and motor current draw ($A$) from `SYS_STATUS`.
  - **Attitude & Kinematics**: Heading/yaw, climb rate, and groundspeed from `GLOBAL_POSITION_INT` / `VFR_HUD`.
- **Two-Way Commands**:
  - `⬆ Upload to Drone`: Uploads waypoints to the flight controller / SITL buffer.
  - `⚡ Arm / Disarm`: Safety motors toggle command.
  - `🏠 RTL`: Triggers immediate autonomous Return-To-Launch.

### 🌬️ Live Meteorological Weather & Wind Dynamics
- **Open-Meteo API**: Fetches current wind speed ($km/h$), wind direction ($0^\circ–360^\circ$), and temperature ($^\circ C$) for the launch coordinate.
- **Aerodynamic Drag Model**:
  $$v_{\text{effective}} = v_{\text{cruise}} - v_{\text{wind}} \cdot \cos(\theta_{\text{heading}} - \theta_{\text{wind\_from}})$$
  Headwinds realistically slow the drone and accelerate LiPo battery consumption; tailwinds provide groundspeed boosts.
- **Dynamic Compass Indicator**: Automatically rotates to display true wind vector direction.

### 🚫 Indian DGCA No-Fly Zone (NFZ) Detection
- **Segment-to-Circle Collision Geometry**: Checks the minimum Euclidean distance between each flight segment and restricted circular airspace.
- **Zone Classification**:
  - 🔴 **Restricted Zones** (SVPI Airport, Gandhinagar Secretariat, Raj Bhavan) — turns path red with pulsing warning banner.
  - 🟡 **Caution Zones** (Sabarmati Ashram, Adalaj Stepwell, University Campus) — highlights path in caution orange.
- **Safety Disclaimer**: Prominently notes that boundaries are for simulation and operators must verify with official DGCA DigitalSky maps.

### 📊 Real-Time Telemetry & Data Logging
- **Chart.js Live Graphs**: Real-time scrolling graphs for battery percentage and groundspeed over elapsed time (throttled at 2 Hz for low CPU overhead).
- **CSV Flight Telemetry Log Export**: Record every telemetry point during flight and export as a standard `.csv` file for lab analysis in Excel, Python, or MATLAB.

### ♿ Accessibility & Device Responsiveness
- **WCAG AA Compliance**: High-contrast typography, ARIA dialog modal, `role="alert"` announcements, and keyboard `Escape` dismissal.
- **Device-Adaptive UI**: Detects desktop, tablet, or mobile viewport and automatically configures layout and telemetry drawers.

---

## Architecture

```
[ Physical Drone (Pixhawk/PX4) ] OR [ ArduPilot SITL Simulator ]
                     │
                     │  MAVLink Telemetry (UDP 14550 or Serial COM)
                     ▼
          ┌─────────────────────┐
          │      bridge.py      │  (Python 3 + pymavlink + websockets)
          │  Telemetry Decoder  │
          └─────────────────────┘
                     │
                     │  JSON Telemetry Stream (ws://localhost:8765)
                     ▼
          ┌─────────────────────┐
          │    Drone Pathika    │  (HTML5 / CSS3 / Vanilla JS)
          │  Web GCS Dashboard  │  Leaflet.js + Chart.js
          └─────────────────────┘
```

---

## Tech Stack

| Component | Technology | Role |
| :--- | :--- | :--- |
| **Frontend Core** | HTML5, CSS3, Vanilla JavaScript (ES6+) | User interface, layout, state engine |
| **Mapping Engine** | [Leaflet.js](https://leafletjs.com/) v1.9.4 | Geospatial rendering, draggable markers |
| **Live Charts** | [Chart.js](https://www.chartjs.org/) v4.4.4 | Telemetry graphs (battery, speed) |
| **Telemetry Bridge** | Python 3, `pymavlink`, `websockets` | Decodes MAVLink & streams over WebSocket |
| **Map Tiles** | [OpenStreetMap](https://www.openstreetmap.org/) | Standard tile layer |
| **Weather Feed** | [Open-Meteo API](https://open-meteo.com/) | Real-time wind speed, direction, temperature |
| **IP Fallback** | [ipapi.co](https://ipapi.co/) | HTTPS-compatible geolocation fallback |

---

## Getting Started

### 1. Run Live in Browser
Open the deployed dashboard:
👉 **[https://harsh4211.github.io/drone.pathika/](https://harsh4211.github.io/drone.pathika/)**

### 2. Run Locally
Clone the repository:
```bash
git clone https://github.com/Harsh4211/drone.pathika.git
cd drone.pathika
```
Start a local HTTP server:
```bash
python -m http.server 8080
```
Open your browser at **`http://localhost:8080`**.

---

## Hardware & SITL Telemetry Bridge (`bridge.py`)

To stream genuine drone telemetry into Drone Pathika:

### Prerequisites
Install Python dependencies:
```bash
pip install pymavlink websockets
```

### Running the Bridge

#### Option A: High-Fidelity Built-in Quadcopter Simulation
If you do not have ArduPilot running, test with realistic 4S LiPo battery sag and flight dynamics:
```bash
python bridge.py --sim
```

#### Option B: ArduPilot / PX4 SITL (Software-in-the-Loop)
Start ArduPilot SITL in your terminal, then launch the bridge:
```bash
python bridge.py --device udp:127.0.0.1:14550
```

#### Option C: Physical Drone via USB Telemetry Radio
Plug your 433/915 MHz telemetry radio (or direct USB cable from Pixhawk) into your computer:
```bash
python bridge.py --device COM3 --baud 57600
```
*(On Linux/macOS, use `--device /dev/ttyUSB0`)*

### Connecting in the Web UI
1. Click **`📡 SITL / Drone: Off`** in the header.
2. The button will illuminate **`🟢 Drone Link: Online`**.
3. Real-time telemetry (flight mode, voltage, current draw, attitude) will stream directly into the dashboard!

---

## File Structure

```
drone.pathika/
├── index.html       # Semantic HTML5 layout, ARIA attributes, SVG icons
├── style.css        # Dark "Mission Control" theme, CSS grid, responsive queries
├── script.js        # Core frontend logic (Modules A through K)
├── bridge.py        # Python MAVLink & SITL telemetry WebSocket gateway
├── .gitignore       # Python cache and IDE exclusions
├── LICENSE          # MIT Open Source License
└── README.md        # Comprehensive documentation
```

### JavaScript Modules in `script.js`

| Module | Lines | Description |
| :--- | :--- | :--- |
| **Config & State** | 1–120 | Global constants, mission state, DOM references |
| **Module A** | 160–340 | Leaflet map setup, draggable waypoints, icon rotation |
| **Module B** | 340–420 | Haversine distance, bearing calculations, segment geometry |
| **Module D** | 420–540 | Chart.js initialization, throttled telemetry plotting |
| **Module C** | 540–810 | Unified simulation engine, wind friction, incremental battery, RTH |
| **Module E** | 810–825 | UI Alert banners and notifications |
| **Module F** | 825–990 | Live device GPS tracking mode (with HTTPS IP fallback) |
| **Module G** | 990–1100 | Device detection (desktop/tablet/mobile) and drawer toggle |
| **Module H** | 1100–1240 | DGCA No-Fly Zones, segment distance collision detection |
| **Module I** | 1240–1370 | Open-Meteo wind API integration and compass visualizer |
| **Module J** | 1370–1540 | WebSocket client, MAVLink telemetry ingestion, drone command dispatch |
| **Module K** | 1540–1650 | Mission JSON export/import & CSV flight log recorder |

---

## Controls & Operations

| Control | Description |
| :--- | :--- |
| **↩ Undo** | Removes the last placed waypoint. |
| **🗑 Clear All** | Clears the flight route, removes markers, and resets telemetry. |
| **▶ Start** | Initiates (or resumes) the flight simulation along planned waypoints. |
| **⏸ Pause / Resume** | Pauses or resumes simulation in mid-air. |
| **↻ Reset** | Resets drone to launch position while preserving waypoints. |
| **📥 Export Plan** | Downloads current waypoints as a `.json` mission file. |
| **📁 Import Plan** | Loads and renders a `.json` waypoint mission file. |
| **📊 Flight CSV** | Exports recorded flight telemetry as a `.csv` log for data analysis. |
| **📡 SITL / Drone Link** | Connects to `bridge.py` for live MAVLink telemetry streaming. |
| **⬆ Upload to Drone** | Transmits waypoint mission to the connected drone/SITL controller. |
| **⚡ Arm / Disarm** | Sends safety motor arm/disarm command to the drone. |
| **🏠 RTL** | Commands Return-to-Launch mode. |

---

## Configuration

Core simulation parameters can be tuned in `script.js`:

```javascript
const ASSUMED_SPEED_KMH           = 36;    // Nominal cruise speed (km/h)
const BATTERY_PER_KM              = 5;     // Battery drain (% per km)
const ALTITUDE_BASELINE           = 50;    // Simulated cruise altitude (meters)
const ALTITUDE_JITTER             = 5;     // Random altitude fluctuation (±m)
const TICK_INTERVAL_MS            = 100;   // Simulation loop interval (ms)
const SIMULATION_SPEED_MULTIPLIER = 3;     // Animation rate multiplier
const BATTERY_CRITICAL            = 10;    // Auto-RTH threshold (%)
const BATTERY_LOW                 = 20;    // Low battery alert threshold (%)
const CHART_UPDATE_INTERVAL_MS    = 500;   // Chart render throttle (ms)
```

---

## Data Sources

| Source | Provider | Protocol | Cost / Requirements |
| :--- | :--- | :--- | :--- |
| **Map Tiles** | OpenStreetMap | HTTPS / Tile PNG | Free (No key) |
| **Wind & Weather** | Open-Meteo API | HTTPS / REST JSON | Free (No key) |
| **Airspace Restrictions** | DGCA India Guidelines | Local Coordinates | Free |
| **IP Geolocation** | ipapi.co | HTTPS / REST JSON | Free (~1,000 req/day) |
| **Telemetry Transport** | MAVLink Protocol | Binary over UDP/Serial | Open standard |

---

## Future Advancements

- [ ] **3D Terrain Visualization**: Integrate Cesium.js or Mapbox GL for 3D elevation-aware flight paths.
- [ ] **Live FPV Video Stream**: Overlay RTSP/WebRTC camera video from drone companion computers.
- [ ] **QGroundControl `.plan` Compatibility**: Direct file interoperability with standard QGC mission formats.
- [ ] **Multi-Drone Swarm Control**: Ingest and track multiple MAVLink system IDs on a single shared airspace map.
- [ ] **Automated Geofence Enforcement**: Soft and hard geofence boundaries with automatic brake-and-hold commands.

---

## License & Authors

This project is licensed under the **MIT License** — see the [LICENSE](LICENSE) file for details.

### Authors
- **Harsh** — Technical Research, Simulation Engine, MAVLink/WebSocket Architecture & Implementation
- **Dikshita Deora** — Physics Research, Aerodynamic Wind Friction Modeling & Airspace Regulations

*Built under BSERC Def-Space Summer Internship 2026.*
