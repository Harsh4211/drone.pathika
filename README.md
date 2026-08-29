# Drone Pathika — Mission Planner & Live Flight Dashboard

> A browser-based drone flight path planner and simulator with live telemetry, real-time weather integration, no-fly zone awareness, and device-adaptive UI — built entirely with vanilla HTML/CSS/JavaScript.

![Status](https://img.shields.io/badge/Status-Active-00e676?style=flat-square)
![License](https://img.shields.io/badge/License-MIT-58a6ff?style=flat-square)
![No Backend](https://img.shields.io/badge/Backend-None%20Required-d29922?style=flat-square)
![API Keys](https://img.shields.io/badge/API%20Keys-Not%20Required-2ea043?style=flat-square)

---

## 📋 Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Tech Stack](#tech-stack)
- [Getting Started](#getting-started)
- [File Structure](#file-structure)
- [How to Use](#how-to-use)
- [Configuration](#configuration)
- [Data Sources](#data-sources)
- [Screenshots](#screenshots)
- [Future Advancements](#future-advancements)
- [Contributing](#contributing)
- [License](#license)

---

## Overview

**Drone Pathika** is a fully client-side web application that combines a flight path planner with a real-time telemetry dashboard. Users plan drone missions by clicking waypoints on an interactive map, then simulate the flight with a moving drone icon while monitoring live altitude, speed, battery, GPS coordinates, and heading — all updating in real time.

The simulator factors in **real-time wind and weather conditions** fetched from the Open-Meteo API, applies **wind friction physics** to the drone's movement, and displays **no-fly zones** based on Indian DGCA regulations.

**Built under BSERC Def-Space Summer Internship 2026 project** — no backend, no database, no paid APIs, no build step required. Just open `index.html` and go.

---

## Features

### Interactive Map & Waypoint Management
- Click anywhere on the map to add numbered waypoints (1, 2, 3...)
- Auto-drawn dashed polyline connecting waypoints in order
- Undo last waypoint or clear all waypoints
- Waypoints turn **green** once the drone has passed through them
- Map powered by **Leaflet.js** with **OpenStreetMap** tiles

### Path Stats Calculator
- **Total Distance** — computed using the Haversine formula (great-circle distance)
- **Estimated Flight Time** — based on configurable cruise speed (default: 36 km/h)
- **Estimated Battery Use** — based on configurable drain rate (default: 5%/km, capped at 100%)
- Stats update live as waypoints are added or removed

### Flight Simulation Engine
- Animated drone icon (SVG arrow) flies along the planned path
- Smooth linear interpolation between waypoints
- **Drone icon rotates** to match its heading direction in real time
- **Resume from last checkpoint** — after completing a route, add more waypoints and continue from where the drone stopped (no need to restart from waypoint 1)
- Pause / Resume / Reset controls
- Configurable simulation speed multiplier

### Live Telemetry Dashboard
- Real-time numeric readouts:
  - **Altitude** (simulated with realistic ±5m fluctuation)
  - **Speed** (m/s with jitter)
  - **Battery %** (decreases proportionally to distance covered)
  - **Latitude / Longitude** (current GPS position)
  - **Heading** (bearing toward next waypoint, 0°–360°)
- Color-coded battery indicator (green → orange → red)

### Live Charts
- **Battery % over Time** — orange line chart, updates every tick
- **Speed over Time** — blue line chart, updates every tick
- Powered by **Chart.js**, capped at 200 data points for performance

### Real-Time Wind & Weather
- Live weather data fetched from **Open-Meteo API** (free, no API key)
- Dashboard shows: wind speed (km/h), wind direction (compass + degrees), temperature (°C)
- Rotating compass arrow indicating wind direction
- Wind effect classification: Calm / Light Breeze / Moderate / Strong
- **Wind friction physics applied to simulation:**
  - `effectiveSpeed = droneSpeed − windSpeed × cos(angleBetweenHeadingAndWind)`
  - **Headwind** → drone slows down, battery drains ~30% faster
  - **Tailwind** → drone speeds up
  - **Crosswind** → no speed change (only lateral drift)
- Click Refresh Weather anytime to update

### No-Fly Zones
- **6 hardcoded restricted zones** near Ahmedabad, India (based on DGCA regulations):
  - SVPI Airport (5 km restricted radius)
  - Gandhinagar Secretariat (2 km restricted)
  - Raj Bhavan / Governor House (1.5 km restricted)
  - Sabarmati Ashram Heritage Zone (1 km caution)
  - Adalaj Stepwell Heritage Zone (0.8 km caution)
  - Gujarat University Campus (1.2 km caution)
- Zones displayed as colored circles on the map (red = restricted, yellow = caution)
- Hover tooltips with zone name, radius, and type
- **Automatic path intersection check** — if flight path enters a no-fly zone:
  - Path line turns **red**
  - Pulsing **warning banner** appears in the dashboard
- Legend panel with zone type indicators

### Alerts & Notifications
- **Low Battery Warning** — pulsing red banner when battery drops below 20%
- **Mission Complete** — modal popup when drone reaches the final waypoint
- **No-Fly Zone Violation** — warning when path intersects restricted airspace

### Simulator / Live Tracking Mode
- **Toggle switch** in the header to switch between modes
- **Simulator mode** — all features as described above
- **Live Tracking mode:**
  - Requests browser GPS permission (Geolocation API)
  - Shows real position as a pulsing red dot on the map
  - Telemetry displays real GPS data (lat, lng, altitude, speed, heading)
  - Falls back to **IP-based approximate location** if GPS is denied
  - "LIVE TRACKING ACTIVE" status banner

### Automatic Device Detection & Responsive UI
- Detects device type using screen width + touch capability + user agent
- Three layouts: **Desktop**, **Tablet**, **Mobile**
- Device badge shows detected type (🖥️ / 📟 / 📱)
- Adaptive changes:

|     Feature      |     Desktop    |        Tablet        |      Mobile      |
|------------------|----------------|----------------------|------------------|
| Layout           | Side-by-side   | Stacked              | Stacked, compact |
| Dashboard        | Always visible | Collapsible          | Collapsible      |
| Map height       | Full available | 55vh                 | 45vh             |
| Buttons          | Standard       | Larger touch targets | Full-width       |
| Waypoint markers | 28px           | 32px                 | 34px             |

- Re-detects on window resize / device rotation
- Collapsible dashboard toggle on tablet/mobile for more map space

---

## Tech Stack

| Technology | Purpose | Source |
|-----------|---------|--------|
| HTML5 / CSS3 / JavaScript (ES5+) | Core application | Vanilla, no framework |
| [Leaflet.js](https://leafletjs.com/) v1.9.4 | Interactive map, markers, polylines | CDN |
| [Chart.js](https://www.chartjs.org/) v4.4.4 | Live line charts | CDN |
| [OpenStreetMap](https://www.openstreetmap.org/) | Map tiles | Free, no key |
| [Open-Meteo](https://open-meteo.com/) | Real-time wind & weather | Free, no key |
| [ip-api.com](http://ip-api.com/) | IP-based geolocation fallback | Free, no key |

**No backend. No database. No build step. No npm. No API keys.**

---

## Getting Started

### Prerequisites
- A modern web browser (Chrome, Firefox, Edge, Safari)

### Setup & Run

- No Setup Needed.
- Just open modern web browser and open https://harsh4211.github.io/drone.pathika

---

## File Structure

```
drone-pathika/
├── index.html      # Page structure, CDN links, all HTML elements
├── style.css       # Dark "mission control" theme, responsive breakpoints
├── script.js       # All application logic (modules A through I)
└── README.md       # This file
```

### JavaScript Modules (inside `script.js`)

| Module | Lines | Purpose |
|--------|-------|---------|
| Config & State | 1–90 | Constants, mission state, app mode |
| Module A | ~90–230 | Map initialization, waypoint management |
| Module B | ~230–330 | Haversine formula, stats calculator |
| Module C | ~560–800 | Simulation engine with resume support |
| Module D | ~330–560 | Telemetry dashboard, Chart.js setup |
| Module E | ~800–815 | Alert system |
| Module F | ~815–1030 | Live GPS tracking mode |
| Module G | ~1085–1190 | Device detection & responsive UI |
| Module H | ~1195–1370 | No-fly zones (data + map rendering + intersection check) |
| Module I | ~1375–1620 | Wind & weather (Open-Meteo API + wind friction physics) |

---

## How to Use

### Step-by-Step Demo

1. **Open** `https://harsh4211.github.io/drone.pathika` in your browser
2. **Click 4–5 points** on the map to plan a route
3. Check the **stats panel** — distance, ETA, and battery use update live
4. Watch for **no-fly zone warnings** if your path crosses restricted airspace
5. Check the **Wind & Weather** panel for current conditions
6. Click **▶ Start Simulation**
7. Watch the drone arrow fly and rotate along the planned path
8. Monitor **live telemetry** numbers and both charts updating in real time
9. If battery drops below 20%, a **red warning** pulses
10. When the drone reaches the last waypoint, **"Mission Complete"** appears
11. Dismiss the modal → **add more waypoints** → click Start to **continue from where you stopped**
12. Use **↻ Reset** to restart from waypoint 1, or **🗑 Clear All** for a blank map

### Controls

| Button | Action |
|--------|--------|
| ↩ Undo Last Point | Remove the last waypoint |
| 🗑 Clear All | Remove all waypoints and reset everything |
| ▶ Start Simulation | Begin (or resume) the flight animation |
| ⏸ Pause / ▶ Resume | Pause or resume mid-flight |
| ↻ Reset | Stop simulation, reset to waypoint 1 (keeps waypoints) |
|  Refresh Weather | Re-fetch live wind/weather data |
| Simulator / Live toggle (Under Development) | Switch between simulation and GPS tracking mode |

---

## Configuration

All configurable constants are at the top of `script.js`:

```javascript
const ASSUMED_SPEED_KMH = 36;              // Drone cruise speed (km/h)
const BATTERY_PER_KM = 5;                  // Battery drain (% per km)
const ALTITUDE_BASELINE = 50;              // Simulated altitude (meters)
const ALTITUDE_JITTER = 5;                 // Altitude fluctuation (±meters)
const TICK_INTERVAL_MS = 100;              // Simulation tick rate (ms)
const SIMULATION_SPEED_MULTIPLIER = 3;     // Animation speed (1 = real-time)
const DEFAULT_CENTER = [23.2156, 72.6369]; // Map center (lat, lng)
const DEFAULT_ZOOM = 13;                   // Initial zoom level
const CHART_MAX_POINTS = 200;              // Max data points on charts
```

---

## Data Sources

| Data | Source | Cost | Key Required |
|------|--------|------|-------------|
| Map tiles | [OpenStreetMap](https://www.openstreetmap.org/) | Free | No |
| Wind & weather | [Open-Meteo API](https://open-meteo.com/) | Free (~10,000 req/day) | No |
| No-fly zones | Hardcoded (based on [DGCA DigitalSky](https://digitalsky.dgca.gov.in/)) | Free | No |
| IP geolocation | [ip-api.com](http://ip-api.com/) | Free (non-commercial) | No |

---

## Screenshots

> *Run the project and try it out — the dark mission control UI is best experienced live!*

**Planned layout:**
- 🖥️ Desktop: Map (left) + Telemetry sidebar (right)
- 📟 Tablet: Map (top) + Collapsible dashboard (bottom)
- 📱 Mobile: Compact stacked layout with touch-friendly controls

---

## Future Advancements

### Near-Term Improvements
- [ ] **GeoJSON Export** — Export planned missions as `.geojson` files for sharing or importing into drone controllers
- [ ] **localStorage Persistence** — Save and reload the last mission between browser sessions
- [ ] **Waypoint Editing** — Drag waypoints to reposition them after placement
- [ ] **Waypoint Altitude** — Set per-waypoint altitude for 3D flight paths
- [ ] **Customizable No-Fly Zones** — Allow users to define their own restricted zones

### API Integrations
- [ ] **Live No-Fly Zone API** — Integrate [Watchtower by Skylark Drones](https://skylarkdrones.com/watchtower) for real-time Indian airspace data
- [ ] **Altitude-Specific Wind** — Use [OpenWeatherMap Wind API](https://openweathermap.org/api/wind-speed) for wind data at drone altitude (50m+) instead of ground level (10m)
- [ ] **DigitalSky NPNT Integration** — Connect to India's official drone permission system for legal compliance
- [ ] **ADS-B Aircraft Tracking** — Overlay nearby manned aircraft positions for collision awareness

### Simulation Enhancements
- [ ] **Multiple Simultaneous Drones** — Simulate a fleet of drones flying different routes at the same time
- [ ] **3D Flight Visualization** — Use Cesium.js or Three.js for 3D terrain-aware flight paths
- [ ] **Obstacle Avoidance Simulation** — Add buildings/trees and simulate automatic rerouting
- [ ] **Return-to-Home (RTH)** — Auto-navigate back to launch point when battery is critical
- [ ] **Geofencing** — Prevent the simulated drone from leaving a defined boundary
- [ ] **Realistic Battery Model** — Factor in payload weight, altitude, temperature, and motor efficiency
- [ ] **Wind Gusts & Turbulence** — Simulate random wind changes during flight for realism

### Hardware Connectivity
- [ ] **MAVLink Protocol Support** — Connect to real drones via WebSocket ↔ MAVLink bridge (e.g., using [MAVProxy](https://ardupilot.org/mavproxy/) or [MAVSDK](https://mavsdk.mavlink.io/))
- [ ] **Telemetry Ingestion** — Receive real telemetry from PX4/ArduPilot flight controllers
- [ ] **Video Feed Overlay** — Display live FPV camera feed from the drone on the map
- [ ] **Mission Upload** — Push planned waypoints directly to the drone's flight controller

### Platform & UX
- [ ] **Progressive Web App (PWA)** — Installable on mobile devices with offline caching
- [ ] **Dark/Light Theme Toggle** — User preference for map and UI theme
- [ ] **Mission History** — Log and replay past flights with telemetry data
- [ ] **Collaborative Planning** — Share mission plans via URL or QR code
- [ ] **Voice Commands** — "Add waypoint", "Start simulation", "Show weather" via Web Speech API
- [ ] **Accessibility (a11y)** — Screen reader support, keyboard navigation, high contrast mode

### Educational Extensions
- [ ] **Physics Visualizer** — Show force vectors (thrust, drag, gravity, wind) on the drone during simulation
- [ ] **Flight Log Export** — Generate a CSV/PDF flight report with telemetry data for lab submissions
- [ ] **Quiz Mode** — Interactive quiz on drone regulations, airspace classes, and flight physics
- [ ] **Code Walkthrough Mode** — Annotated step-through of each module for learning

---

## Contributing

This is a student project under an Internship, but contributions are welcome!

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Commit your changes: `git commit -m "Add my feature"`
4. Push to the branch: `git push origin feature/my-feature`
5. Open a Pull Request

---

## License

This project is open source and available under the [MIT License](LICENSE).

---

## Acknowledgments

- **[Leaflet.js](https://leafletjs.com/)** — The best open-source JS library for interactive maps
- **[Chart.js](https://www.chartjs.org/)** — Simple yet flexible charting
- **[OpenStreetMap](https://www.openstreetmap.org/)** — Free map tiles for everyone
- **[Open-Meteo](https://open-meteo.com/)** — Free weather API, no key required
- **[DGCA India](https://digitalsky.dgca.gov.in/)** — Drone regulation reference

---

<p align="center">
  Built with tea and curiosity<br>
  <strong>Drone Pathika</strong> — Plan. Simulate. Fly.
</p>
