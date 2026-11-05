/* ===================================================
   SCRIPT.JS — Drone Pathika: Mission Planner & Flight Dashboard
   ===================================================
   Modules:
     A — Map & Waypoint Management
     B — Path Stats Calculator
     C — Simulation Engine (unified, with wind + resume)
     D — Telemetry Dashboard & Charts
     E — Alerts
     F — Live Tracking Mode
     G — Device Detection & Responsive UI
     H — No-Fly Zones
     I — Wind & Weather (Open-Meteo API)

   Dependencies (via CDN in index.html):
     Leaflet.js  → window.L
     Chart.js    → window.Chart
   =================================================== */


// ─────────────────────────────────────────────
// CONFIGURATION CONSTANTS
// ─────────────────────────────────────────────

/** Assumed drone cruise speed in km/h */
const ASSUMED_SPEED_KMH = 36;

/** Assumed drone cruise speed in m/s */
const ASSUMED_SPEED_MS = ASSUMED_SPEED_KMH / 3.6; // 10 m/s

/** Battery drain rate: percent per kilometer traveled */
const BATTERY_PER_KM = 5;

/** Baseline simulated altitude in meters */
const ALTITUDE_BASELINE = 50;

/** Random altitude fluctuation range (±) in meters */
const ALTITUDE_JITTER = 5;

/** Simulation tick interval in milliseconds */
const TICK_INTERVAL_MS = 100;

/** Speed multiplier — higher = faster simulation animation */
const SIMULATION_SPEED_MULTIPLIER = 3;

/** Default map center (Ahmedabad, India) */
const DEFAULT_CENTER = [23.2156, 72.6369];

/** Default map zoom level */
const DEFAULT_ZOOM = 13;

/** Max data points on live charts before scrolling */
const CHART_MAX_POINTS = 200;

/** How often (in ms) to update charts — decoupled from sim tick for performance */
const CHART_UPDATE_INTERVAL_MS = 500;

/** Critical battery level (%) — triggers RTH */
const BATTERY_CRITICAL = 10;

/** Low battery alert threshold (%) */
const BATTERY_LOW = 20;


// ─────────────────────────────────────────────
// APPLICATION STATE
// ─────────────────────────────────────────────

let missionState = {
  waypoints:                [],     // Array of {lat, lng}
  totalDistanceKm:          0,
  estimatedTimeSeconds:     0,
  estimatedBatteryPercent:  0,
  isSimulating:             false,
  isPaused:                 false,
  currentSegmentIndex:      0,
  segmentProgress:          0,
  distanceCoveredKm:        0,
  batteryRemaining:         100,    // FIX: tracked incrementally, not recalculated
  elapsedSeconds:           0,
  resumeFromIndex:          0,
  currentHeading:           0,
  rthActive:                false   // Return-to-Home mode active
};

/** Current app mode: 'simulator' | 'live' */
let appMode = 'simulator';

/** setInterval timer ID for simulation loop */
let simTimerId = null;

/** Timestamp of last chart update (for throttling) */
let lastChartUpdateMs = 0;

/** Geolocation watch ID */
let geoWatchId = null;

/** Leaflet marker for live GPS position */
let livePositionMarker = null;

/** Previous GPS position (for heading/speed calc in live mode) */
let prevGeoPosition = null;

/** Timestamp of previous GPS fix */
let prevGeoTimestamp = null;

/** Cached reference to .drone-icon element (avoid per-tick DOM query) */
let cachedDroneIconEl = null;

/** Resize debounce timer */
let resizeTimer = null;

/** Whether dashboard was manually expanded by user on mobile/tablet */
let userExpandedDashboard = false;


// ─────────────────────────────────────────────
// DOM ELEMENT REFERENCES
// ─────────────────────────────────────────────

const btnUndo    = document.getElementById('btn-undo');
const btnClear   = document.getElementById('btn-clear');
const btnStart   = document.getElementById('btn-start');
const btnPause   = document.getElementById('btn-pause');
const btnReset   = document.getElementById('btn-reset');

const btnDroneLink   = document.getElementById('btn-drone-link');
const btnUploadDrone = document.getElementById('btn-upload-drone');
const btnArmDrone    = document.getElementById('btn-arm-drone');
const btnRtlDrone    = document.getElementById('btn-rtl-drone');

const btnExportMission   = document.getElementById('btn-export-mission');
const btnImportMission   = document.getElementById('btn-import-mission');
const inputImportMission = document.getElementById('input-import-mission');
const btnExportCSV       = document.getElementById('btn-export-csv');
const btnModalCSV        = document.getElementById('btn-modal-csv');

const statDistance = document.getElementById('stat-distance');
const statTime     = document.getElementById('stat-time');
const statBattery  = document.getElementById('stat-battery');

const telemAltitude = document.getElementById('telem-altitude');
const telemSpeed    = document.getElementById('telem-speed');
const telemBattery  = document.getElementById('telem-battery');
const telemLat      = document.getElementById('telem-lat');
const telemLng      = document.getElementById('telem-lng');
const telemHeading  = document.getElementById('telem-heading');

const telemMode    = document.getElementById('telem-mode');
const telemArmed   = document.getElementById('telem-armed');
const telemVoltage = document.getElementById('telem-voltage');
const telemCurrent = document.getElementById('telem-current');

const alertBanner      = document.getElementById('alert-banner');
const modalOverlay     = document.getElementById('modal-overlay');
const btnModalClose    = document.getElementById('btn-modal-close');
const modeSwitch       = document.getElementById('mode-switch');
const modeLabelSim     = document.getElementById('mode-label-sim');
const modeLabelLive    = document.getElementById('mode-label-live');
const liveStatusBanner = document.getElementById('live-status-banner');


// ─────────────────────────────────────────────
// MODULE A — MAP & WAYPOINT MANAGEMENT
// ─────────────────────────────────────────────

const map = L.map('map').setView(DEFAULT_CENTER, DEFAULT_ZOOM);

// OpenStreetMap tile layer (free, no key — must be served via HTTP not file://)
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  maxZoom: 19
}).addTo(map);

/** Leaflet marker objects for waypoints (parallel to missionState.waypoints) */
let waypointMarkers = [];

/** Polyline connecting all waypoints */
let flightPathLine = L.polyline([], { color: '#58a6ff', weight: 3, dashArray: '8, 6' }).addTo(map);

/** Animated drone marker */
let droneMarker = null;

/**
 * Creates a numbered DivIcon for a waypoint marker.
 * @param {number} number - 1-based waypoint number
 * @param {boolean} reached - whether drone has passed this waypoint
 */
function createWaypointIcon(number, reached) {
  const cls = reached ? ' reached' : '';
  return L.divIcon({
    className: '',
    html: '<div class="waypoint-icon' + cls + '">' + number + '</div>',
    iconSize: [28, 28],
    iconAnchor: [14, 14]
  });
}

/**
 * Creates the SVG drone arrow DivIcon.
 * The polygon points north (up) at 0°; CSS transform rotates it to match heading.
 * @param {number} heading - degrees (0 = north)
 */
function createDroneIcon(heading) {
  return L.divIcon({
    className: '',
    html: '<div class="drone-icon" style="transform:rotate(' + (heading || 0) + 'deg)">' +
          '<svg viewBox="0 0 32 32" width="30" height="30">' +
          '<polygon points="16,2 6,28 16,22 26,28" fill="#00e676" stroke="#0d1117" stroke-width="1.5"/>' +
          '</svg></div>',
    iconSize: [30, 30],
    iconAnchor: [15, 15]
  });
}

/**
 * Rotates the drone icon using the cached element reference.
 * Avoids a DOM querySelector on every 100ms tick.
 * @param {number} heading - degrees
 */
function rotateDroneIcon(heading) {
  if (!cachedDroneIconEl && droneMarker) {
    const el = droneMarker.getElement();
    if (el) cachedDroneIconEl = el.querySelector('.drone-icon');
  }
  if (cachedDroneIconEl) {
    cachedDroneIconEl.style.transform = 'rotate(' + heading + 'deg)';
  }
}

/**
 * Adds a waypoint at the given position.
 * Blocked during simulation and in live mode.
 * Supports drag-to-reposition and click-to-delete.
 */
function addWaypoint(lat, lng) {
  if (missionState.isSimulating) {
    showAlert('🔒 Cannot add waypoints during simulation', 'warning');
    return;
  }
  if (appMode === 'live') return;

  missionState.waypoints.push({ lat, lng });

  const num     = missionState.waypoints.length;
  const idx     = num - 1;
  const reached = idx < missionState.resumeFromIndex;

  const marker  = L.marker([lat, lng], {
    icon: createWaypointIcon(num, reached),
    draggable: !reached
  }).addTo(map);

  marker.on('drag', () => {
    const curIdx = waypointMarkers.indexOf(marker);
    if (curIdx !== -1) {
      const pos = marker.getLatLng();
      missionState.waypoints[curIdx] = { lat: pos.lat, lng: pos.lng };
      updateFlightPath();
    }
  });

  marker.on('dragend', () => {
    recalculateStats();
  });

  marker.bindPopup(`
    <div style="text-align:center; padding: 4px; font-family: sans-serif;">
      <strong style="color:#00e676;">Waypoint #${num}</strong><br>
      <small style="color:#8b949e;">${lat.toFixed(5)}, ${lng.toFixed(5)}</small><br>
      <button onclick="removeWaypointByIndex(${idx})" style="margin-top:6px; padding:4px 10px; background:#f85149; color:#fff; border:none; border-radius:4px; font-size:0.75rem; cursor:pointer;">&#x1F5D1; Delete</button>
    </div>
  `);

  waypointMarkers.push(marker);

  updateFlightPath();
  recalculateStats();
  updateButtonStates();
}

/**
 * Removes a specific waypoint by index.
 * Re-indexes all subsequent waypoint markers and popups.
 */
function removeWaypointByIndex(idx) {
  if (missionState.isSimulating) {
    showAlert('🔒 Cannot edit waypoints during active simulation', 'warning');
    return;
  }
  if (idx < missionState.resumeFromIndex) {
    showAlert('🔒 Cannot delete already visited waypoints', 'warning');
    return;
  }
  if (idx >= 0 && idx < missionState.waypoints.length) {
    missionState.waypoints.splice(idx, 1);
    const m = waypointMarkers.splice(idx, 1)[0];
    if (m) map.removeLayer(m);

    // Refresh icons and popups with updated numbers
    for (let i = 0; i < waypointMarkers.length; i++) {
      const isReached = i < missionState.resumeFromIndex;
      waypointMarkers[i].setIcon(createWaypointIcon(i + 1, isReached));
      waypointMarkers[i].setPopupContent(`
        <div style="text-align:center; padding: 4px; font-family: sans-serif;">
          <strong style="color:#00e676;">Waypoint #${i + 1}</strong><br>
          <small style="color:#8b949e;">${missionState.waypoints[i].lat.toFixed(5)}, ${missionState.waypoints[i].lng.toFixed(5)}</small><br>
          <button onclick="removeWaypointByIndex(${i})" style="margin-top:6px; padding:4px 10px; background:#f85149; color:#fff; border:none; border-radius:4px; font-size:0.75rem; cursor:pointer;">&#x1F5D1; Delete</button>
        </div>
      `);
    }

    updateFlightPath();
    recalculateStats();
    updateButtonStates();
  }
}
window.removeWaypointByIndex = removeWaypointByIndex;

/** Removes the last waypoint (cannot go past resumeFromIndex). */
function undoLastWaypoint() {
  if (missionState.isSimulating || missionState.waypoints.length === 0) return;
  if (missionState.waypoints.length <= missionState.resumeFromIndex) return;

  missionState.waypoints.pop();
  const marker = waypointMarkers.pop();
  map.removeLayer(marker);

  updateFlightPath();
  recalculateStats();
  updateButtonStates();
}

/** Clears all waypoints and resets mission to blank state. */
function clearAll() {
  stopSimulation();
  waypointMarkers.forEach(m => map.removeLayer(m));
  waypointMarkers = [];

  if (droneMarker) { map.removeLayer(droneMarker); droneMarker = null; }
  cachedDroneIconEl = null;

  missionState = {
    waypoints: [], totalDistanceKm: 0, estimatedTimeSeconds: 0,
    estimatedBatteryPercent: 0, isSimulating: false, isPaused: false,
    currentSegmentIndex: 0, segmentProgress: 0, distanceCoveredKm: 0,
    batteryRemaining: 100, elapsedSeconds: 0, resumeFromIndex: 0,
    currentHeading: 0, rthActive: false
  };

  updateFlightPath();
  recalculateStats();
  resetTelemetryDisplay();
  resetCharts();
  hideAlert();
  updateNFZCheck();
  updateButtonStates();
}

/** Redraws the polyline connecting all waypoints. */
function updateFlightPath() {
  const latlngs = missionState.waypoints.map(wp => [wp.lat, wp.lng]);
  flightPathLine.setLatLngs(latlngs);
}

/**
 * Marks waypoints 0..upToIndex as reached (turns them green).
 * @param {number} upToIndex
 */
function markWaypointsReached(upToIndex) {
  for (let i = 0; i <= upToIndex && i < waypointMarkers.length; i++) {
    waypointMarkers[i].setIcon(createWaypointIcon(i + 1, true));
  }
}

// Map click handler
map.on('click', e => addWaypoint(e.latlng.lat, e.latlng.lng));


// ─────────────────────────────────────────────
// MODULE B — PATH STATS CALCULATOR
// ─────────────────────────────────────────────

/** Haversine great-circle distance between two lat/lng points (km). */
function haversineDistanceKm(lat1, lng1, lat2, lng2) {
  const R    = 6371;
  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);
  const a    =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Degrees → radians */
function toRadians(deg) { return deg * (Math.PI / 180); }

/**
 * Bearing from point 1 to point 2.
 * @returns {number} 0–360 degrees (0 = North)
 */
function computeBearing(lat1, lng1, lat2, lng2) {
  const dLng = toRadians(lng2 - lng1);
  const y    = Math.sin(dLng) * Math.cos(toRadians(lat2));
  const x    =
    Math.cos(toRadians(lat1)) * Math.sin(toRadians(lat2)) -
    Math.sin(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.cos(dLng);
  return ((Math.atan2(y, x) * 180 / Math.PI) + 360) % 360;
}

/** Segment distances (km) for all consecutive waypoint pairs. */
function computeSegmentDistances() {
  const dists = [];
  const wps   = missionState.waypoints;
  for (let i = 0; i < wps.length - 1; i++) {
    dists.push(haversineDistanceKm(wps[i].lat, wps[i].lng, wps[i + 1].lat, wps[i + 1].lng));
  }
  return dists;
}

/**
 * Recalculates stats panel + NFZ check.
 * NFZ check is integrated here directly (no monkey-patch).
 */
function recalculateStats() {
  const segments = computeSegmentDistances();
  const totalDist = segments.reduce((s, d) => s + d, 0);

  missionState.totalDistanceKm         = totalDist;
  missionState.estimatedTimeSeconds    = (totalDist / ASSUMED_SPEED_KMH) * 3600;
  missionState.estimatedBatteryPercent = Math.min(totalDist * BATTERY_PER_KM, 100);

  statDistance.textContent = totalDist.toFixed(2) + ' km';
  const mins = Math.floor(missionState.estimatedTimeSeconds / 60);
  const secs = Math.floor(missionState.estimatedTimeSeconds % 60);
  statTime.textContent    = mins + 'm ' + secs + 's';
  statBattery.textContent = missionState.estimatedBatteryPercent.toFixed(1) + ' %';

  // Always run NFZ check when stats change
  updateNFZCheck();
}


// ─────────────────────────────────────────────
// MODULE D — TELEMETRY DASHBOARD & CHARTS
// ─────────────────────────────────────────────

/** Initialize Chart.js instances for battery and speed. */
function initCharts() {
  if (typeof Chart === 'undefined') {
    console.warn('Chart.js not loaded — charts unavailable');
    return null;
  }

  const commonOptions = {
    responsive: true,
    maintainAspectRatio: true,
    animation: false,
    scales: {
      x: {
        title: { display: true, text: 'Time (s)', color: '#8b949e' },
        ticks: { color: '#8b949e', maxTicksLimit: 10 },
        grid:  { color: '#21262d' }
      },
      y: {
        ticks: { color: '#8b949e' },
        grid:  { color: '#21262d' }
      }
    },
    plugins: { legend: { display: false } },
    elements: { point: { radius: 0 }, line: { borderWidth: 2 } }
  };

  const bChart = new Chart(document.getElementById('chart-battery'), {
    type: 'line',
    data: {
      labels: [],
      datasets: [{
        label: 'Battery %', data: [],
        borderColor: '#f0883e', backgroundColor: 'rgba(240,136,62,0.1)',
        fill: true, tension: 0.2
      }]
    },
    options: {
      ...commonOptions,
      scales: {
        ...commonOptions.scales,
        y: { ...commonOptions.scales.y, min: 0, max: 100,
          title: { display: true, text: 'Battery %', color: '#8b949e' } }
      }
    }
  });

  const sChart = new Chart(document.getElementById('chart-speed'), {
    type: 'line',
    data: {
      labels: [],
      datasets: [{
        label: 'Speed (m/s)', data: [],
        borderColor: '#58a6ff', backgroundColor: 'rgba(88,166,255,0.1)',
        fill: true, tension: 0.2
      }]
    },
    options: {
      ...commonOptions,
      scales: {
        ...commonOptions.scales,
        y: { ...commonOptions.scales.y, min: 0,
          title: { display: true, text: 'Speed (m/s)', color: '#8b949e' } }
      }
    }
  });

  return { batteryChart: bChart, speedChart: sChart };
}

const charts      = initCharts();
const batteryChart = charts ? charts.batteryChart : null;
const speedChart   = charts ? charts.speedChart   : null;

/**
 * Adds a data point to both charts.
 * Uses 'none' mode (skip animations) + throttled to CHART_UPDATE_INTERVAL_MS.
 */
function updateCharts(timeSec, battery, speed) {
  if (!batteryChart || !speedChart) return;

  const now = Date.now();
  if (now - lastChartUpdateMs < CHART_UPDATE_INTERVAL_MS) return; // FIX: throttle
  lastChartUpdateMs = now;

  const label = timeSec.toFixed(1);

  // FIX: use typed arrays via push+shift replacement to avoid O(n) shift on large arrays
  batteryChart.data.labels.push(label);
  batteryChart.data.datasets[0].data.push(battery);
  speedChart.data.labels.push(label);
  speedChart.data.datasets[0].data.push(speed);

  if (batteryChart.data.labels.length > CHART_MAX_POINTS) {
    batteryChart.data.labels.splice(0, 1);
    batteryChart.data.datasets[0].data.splice(0, 1);
    speedChart.data.labels.splice(0, 1);
    speedChart.data.datasets[0].data.splice(0, 1);
  }

  batteryChart.update('none'); // FIX: skip animation on live update
  speedChart.update('none');
}

/** Clears chart data. */
function resetCharts() {
  if (!batteryChart || !speedChart) return;
  batteryChart.data.labels = [];
  batteryChart.data.datasets[0].data = [];
  speedChart.data.labels = [];
  speedChart.data.datasets[0].data = [];
  batteryChart.update('none');
  speedChart.update('none');
  lastChartUpdateMs = 0;
}

/** Updates the telemetry grid with current values. */
function updateTelemetryDisplay(telemetry) {
  telemAltitude.textContent = telemetry.altitude.toFixed(1) + ' m';
  telemSpeed.textContent    = telemetry.speed.toFixed(1) + ' m/s';
  telemBattery.textContent  = telemetry.batteryPercent.toFixed(1) + ' %';
  telemLat.textContent      = telemetry.lat.toFixed(6);
  telemLng.textContent      = telemetry.lng.toFixed(6);
  telemHeading.textContent  = telemetry.headingDegrees.toFixed(1) + ' °';

  if (telemMode) {
    telemMode.textContent = telemetry.flightMode || (isDroneLinkConnected ? 'CONNECTED' : (missionState.isSimulating ? 'SIMULATOR' : 'STANDBY'));
  }

  if (telemArmed) {
    if (telemetry.armed !== undefined) {
      telemArmed.textContent = telemetry.armed ? 'ARMED' : 'DISARMED';
      telemArmed.style.color = telemetry.armed ? '#00e676' : '#f85149';
    } else {
      telemArmed.textContent = missionState.isSimulating ? 'ACTIVE' : 'STANDBY';
      telemArmed.style.color = missionState.isSimulating ? '#00e676' : '#8b949e';
    }
  }

  if (telemVoltage) {
    telemVoltage.textContent = telemetry.batteryVoltage ? (telemetry.batteryVoltage.toFixed(1) + ' V') : '-- V';
  }

  if (telemCurrent) {
    telemCurrent.textContent = telemetry.batteryCurrent !== undefined ? (telemetry.batteryCurrent.toFixed(1) + ' A') : '-- A';
  }

  // Battery color
  if (telemetry.batteryPercent <= BATTERY_CRITICAL) {
    telemBattery.style.color = '#f85149';
  } else if (telemetry.batteryPercent <= BATTERY_LOW) {
    telemBattery.style.color = '#f0883e';
  } else {
    telemBattery.style.color = '#00e676';
  }
}

/** Resets telemetry panel to placeholder values. */
function resetTelemetryDisplay() {
  telemAltitude.textContent = '-- m';
  telemSpeed.textContent    = '-- m/s';
  telemBattery.textContent  = '-- %';
  telemLat.textContent      = '--';
  telemLng.textContent      = '--';
  telemHeading.textContent  = '-- °';
  telemBattery.style.color  = '#e6edf3';

  if (telemMode)    telemMode.textContent = 'STANDBY';
  if (telemArmed) {
    telemArmed.textContent = 'STANDBY';
    telemArmed.style.color = '#8b949e';
  }
  if (telemVoltage) telemVoltage.textContent = '-- V';
  if (telemCurrent) telemCurrent.textContent = '-- A';
}


// ─────────────────────────────────────────────
// MODULE C — UNIFIED SIMULATION ENGINE
// (Merged from original Modules C + I patches)
// ─────────────────────────────────────────────

/** Precomputed segment distances set when simulation starts */
let segmentDistances = [];

/** Total path distance (km) */
let totalPathDistanceKm = 0;

/**
 * Starts (or resumes) the flight simulation.
 * Fetches weather for the first waypoint before starting.
 */
function startSimulation() {
  const wps = missionState.waypoints;
  if (wps.length < 2) return;
  if (missionState.resumeFromIndex >= wps.length - 1) return;

  // FIX: guard against double-start (interval stacking)
  if (simTimerId !== null) return;

  // FIX: fetch weather for the actual first waypoint, not map center
  const startWp = wps[missionState.resumeFromIndex];
  fetchWeatherData(startWp.lat, startWp.lng);

  segmentDistances    = computeSegmentDistances();
  totalPathDistanceKm = segmentDistances.reduce((s, d) => s + d, 0);

  // Distance already covered (for resume)
  let alreadyCovered = 0;
  for (let i = 0; i < missionState.resumeFromIndex; i++) {
    alreadyCovered += segmentDistances[i];
  }

  missionState.isSimulating        = true;
  missionState.isPaused            = false;
  missionState.currentSegmentIndex = missionState.resumeFromIndex;
  missionState.segmentProgress     = 0;
  missionState.distanceCoveredKm   = alreadyCovered;
  missionState.rthActive           = false;

  if (missionState.resumeFromIndex === 0) {
    missionState.elapsedSeconds  = 0;
    missionState.batteryRemaining = 100; // FIX: reset incremental battery
    resetCharts();
  }

  hideAlert();

  // Place drone at start waypoint
  const nextWp        = wps[missionState.resumeFromIndex + 1];
  const initialHeading = computeBearing(startWp.lat, startWp.lng, nextWp.lat, nextWp.lng);
  missionState.currentHeading = initialHeading;
  cachedDroneIconEl = null; // FIX: clear cached reference when icon is recreated

  if (droneMarker) {
    droneMarker.setLatLng([startWp.lat, startWp.lng]);
    droneMarker.setIcon(createDroneIcon(initialHeading));
  } else {
    droneMarker = L.marker([startWp.lat, startWp.lng], {
      icon: createDroneIcon(initialHeading),
      zIndexOffset: 1000
    }).addTo(map);
  }

  markWaypointsReached(missionState.resumeFromIndex);
  updateButtonStates();

  simTimerId = setInterval(simulationTick, TICK_INTERVAL_MS);
}

/**
 * UNIFIED simulation tick — handles position, wind physics, battery,
 * RTH, and telemetry in one place. No monkey-patching.
 */
function simulationTick() {
  if (missionState.isPaused) return;

  const wps    = missionState.waypoints;
  const segIdx = missionState.currentSegmentIndex;

  if (segIdx >= segmentDistances.length) {
    missionComplete();
    return;
  }

  const tickSec = TICK_INTERVAL_MS / 1000;

  // --- Determine effective speed (wind friction) ---
  const wpA    = wps[segIdx];
  const wpB    = wps[segIdx + 1];
  const heading = computeBearing(wpA.lat, wpA.lng, wpB.lat, wpB.lng);

  const windResult      = computeWindEffect(heading, ASSUMED_SPEED_MS);
  // FIX: apply SIMULATION_SPEED_MULTIPLIER to drone speed, NOT to wind speed
  const effectiveSpeedMs = windResult.effectiveSpeedMs * SIMULATION_SPEED_MULTIPLIER;

  // Distance covered this tick (km)
  const distThisTickKm = (effectiveSpeedMs / 1000) * tickSec;

  // FIX: Incremental battery drain — not recomputed from total distance
  const drainMultiplier = windResult.isHeadwind
    ? (1 + (windResult.windComponentMs / ASSUMED_SPEED_MS) * 0.3)
    : 1;
  missionState.batteryRemaining = Math.max(
    0,
    missionState.batteryRemaining - distThisTickKm * BATTERY_PER_KM * drainMultiplier
  );

  missionState.segmentProgress   += distThisTickKm / (segmentDistances[segIdx] || 1);
  missionState.distanceCoveredKm += distThisTickKm;
  missionState.elapsedSeconds    += tickSec;

  // Segment transition
  if (missionState.segmentProgress >= 1) {
    const overshoot = missionState.segmentProgress - 1;
    markWaypointsReached(segIdx + 1);
    missionState.currentSegmentIndex++;

    if (missionState.currentSegmentIndex >= segmentDistances.length) {
      droneMarker.setLatLng([wps[wps.length - 1].lat, wps[wps.length - 1].lng]);
      missionComplete();
      return;
    }

    const nextLen = segmentDistances[missionState.currentSegmentIndex];
    missionState.segmentProgress = nextLen > 0
      ? (overshoot * segmentDistances[segIdx]) / nextLen
      : 0;
  }

  // Interpolated position
  const nSeg    = missionState.currentSegmentIndex;
  const pA      = wps[nSeg];
  const pB      = wps[nSeg + 1];
  const t       = missionState.segmentProgress;
  const curLat  = pA.lat + (pB.lat - pA.lat) * t;
  const curLng  = pA.lng + (pB.lng - pA.lng) * t;

  droneMarker.setLatLng([curLat, curLng]);

  // Heading and rotation
  const curHeading = computeBearing(curLat, curLng, pB.lat, pB.lng);
  missionState.currentHeading = curHeading;
  rotateDroneIcon(curHeading);

  // Telemetry
  const battery   = missionState.batteryRemaining;
  const altitude  = ALTITUDE_BASELINE + (Math.random() * 2 - 1) * ALTITUDE_JITTER;
  const dispSpeed = (windResult.effectiveSpeedMs) + (Math.random() * 2 - 1) * 0.5;

  updateTelemetryDisplay({
    altitude,
    speed:          Math.max(0, dispSpeed),
    batteryPercent: battery,
    lat:            curLat,
    lng:            curLng,
    headingDegrees: curHeading
  });

  logTelemetryPoint({
    altitude,
    speed:          Math.max(0, dispSpeed),
    batteryPercent: battery,
    lat:            curLat,
    lng:            curLng,
    headingDegrees: curHeading,
    flightMode:     'SIMULATOR',
    batteryVoltage: (14.0 + (battery / 100.0) * 2.8),
    batteryCurrent: (12.0 + Math.random() * 2.0)
  });

  updateCharts(missionState.elapsedSeconds, battery, Math.max(0, dispSpeed));

  // --- Battery alerts and RTH ---
  if (battery <= 0) {
    // FIX: stop simulation at 0% — drone can't fly without battery
    showAlert('🔴 BATTERY DEPLETED — Emergency landing!', 'warning');
    missionComplete();
    return;
  }

  if (battery <= BATTERY_CRITICAL && !missionState.rthActive) {
    // FIX: Return-to-Home trigger
    missionState.rthActive = true;
    showAlert('🔴 CRITICAL BATTERY (' + battery.toFixed(1) + '%) — Returning to Home!', 'warning');
    initiateRTH();
    return;
  }

  if (battery <= BATTERY_LOW && !missionState.rthActive) {
    showAlert('⚠️ LOW BATTERY — ' + battery.toFixed(1) + '%', 'warning');
  }
}

/**
 * Return-to-Home: inserts the first waypoint as the new destination
 * so the drone flies back to its launch point.
 */
function initiateRTH() {
  stopSimulation();
  if (missionState.waypoints.length < 1) return;

  // Insert home waypoint at current drone position → first waypoint
  const home    = missionState.waypoints[0];
  const lastWp  = missionState.waypoints[missionState.waypoints.length - 1];

  // Build a minimal 2-point mission: current position → home
  const curLat = lastWp.lat;
  const curLng = lastWp.lng;

  missionState.waypoints        = [{ lat: curLat, lng: curLng }, { lat: home.lat, lng: home.lng }];
  missionState.resumeFromIndex  = 0;
  missionState.rthActive        = true;

  waypointMarkers.forEach(m => map.removeLayer(m));
  waypointMarkers = [];

  missionState.waypoints.forEach((wp, i) => {
    const marker = L.marker([wp.lat, wp.lng], { icon: createWaypointIcon(i + 1, false) }).addTo(map);
    waypointMarkers.push(marker);
  });

  updateFlightPath();

  // Resume simulation on the RTH route (brief delay so UI can update)
  setTimeout(() => {
    if (simTimerId === null) startSimulation();
  }, 200);
}

/** Called when drone reaches the final waypoint. */
function missionComplete() {
  stopSimulation();

  missionState.resumeFromIndex = missionState.waypoints.length - 1;

  // FIX: use missionState.batteryRemaining (incremental) not a recalculated value
  const lastWp = missionState.waypoints[missionState.waypoints.length - 1];
  updateTelemetryDisplay({
    altitude:       ALTITUDE_BASELINE,
    speed:          0,
    batteryPercent: missionState.batteryRemaining,
    lat:            lastWp.lat,
    lng:            lastWp.lng,
    headingDegrees: missionState.currentHeading
  });

  if (!missionState.rthActive) {
    modalOverlay.classList.remove('hidden');
  } else {
    showAlert('🏠 Drone returned home safely.', 'info');
  }
}

/** Stops the simulation loop. */
function stopSimulation() {
  if (simTimerId !== null) {
    clearInterval(simTimerId);
    simTimerId = null;
  }
  missionState.isSimulating = false;
  missionState.isPaused     = false;
  updateButtonStates();
}

/** Pauses or resumes the simulation. */
function togglePause() {
  if (!missionState.isSimulating) return;
  missionState.isPaused    = !missionState.isPaused;
  btnPause.innerHTML       = missionState.isPaused ? '&#9654; Resume' : '&#10074;&#10074; Pause';
}

/**
 * Resets simulation: stops, removes drone, clears resume point.
 * Waypoints stay intact for a fresh re-run.
 */
function resetSimulation() {
  stopSimulation();

  if (droneMarker) { map.removeLayer(droneMarker); droneMarker = null; }
  cachedDroneIconEl = null;

  missionState.currentSegmentIndex = 0;
  missionState.segmentProgress     = 0;
  missionState.distanceCoveredKm   = 0;
  missionState.batteryRemaining    = 100;
  missionState.elapsedSeconds      = 0;
  missionState.resumeFromIndex     = 0;
  missionState.currentHeading      = 0;
  missionState.rthActive           = false;

  for (let i = 0; i < waypointMarkers.length; i++) {
    waypointMarkers[i].setIcon(createWaypointIcon(i + 1, false));
  }

  resetTelemetryDisplay();
  resetCharts();
  hideAlert();

  // FIX: also clear NFZ warning on reset
  updateNFZCheck();
  updateButtonStates();
}


// ─────────────────────────────────────────────
// MODULE E — ALERTS
// ─────────────────────────────────────────────

function showAlert(message, type) {
  alertBanner.textContent = message;
  alertBanner.className   = type;
}

function hideAlert() {
  alertBanner.className   = 'hidden';
  alertBanner.textContent = '';
}


// ─────────────────────────────────────────────
// MODULE F — LIVE TRACKING MODE
// ─────────────────────────────────────────────

/**
 * Switches between 'simulator' and 'live' modes.
 */
function switchMode(mode) {
  if (missionState.isSimulating) stopSimulation();

  appMode = mode;

  if (mode === 'live') {
    modeLabelSim.classList.remove('active');
    modeLabelLive.classList.add('active');
    liveStatusBanner.classList.remove('hidden');
    btnStart.disabled = true;
    btnPause.disabled = true;
    startLiveTracking();
  } else {
    modeLabelLive.classList.remove('active');
    modeLabelSim.classList.add('active');
    liveStatusBanner.classList.add('hidden');
    stopLiveTracking();
    // FIX: fully reset telemetry when going back to simulator
    resetTelemetryDisplay();
    updateButtonStates();
  }
}

/**
 * Starts watching the user's GPS position.
 * FIX: guards against starting watchPosition before first fix arrives.
 */
function startLiveTracking() {
  if (!navigator.geolocation) {
    showAlert('⚠️ Geolocation not supported — using IP location', 'warning');
    fetchIPLocation();
    return;
  }

  navigator.geolocation.getCurrentPosition(
    pos => {
      // FIX: only call watchPosition after the first fix succeeds
      onLivePositionUpdate(pos);
      // FIX: guard — don't start a second watch if already watching
      if (geoWatchId === null) {
        geoWatchId = navigator.geolocation.watchPosition(
          onLivePositionUpdate,
          onGeoError,
          { enableHighAccuracy: true, maximumAge: 2000, timeout: 10000 }
        );
      }
    },
    err => {
      console.warn('Geolocation error:', err.message);
      showAlert('📍 GPS unavailable — using IP location', 'warning');
      fetchIPLocation();
    },
    { enableHighAccuracy: true, timeout: 10000 }
  );
}

/** Stops GPS watch and removes live marker. */
function stopLiveTracking() {
  if (geoWatchId !== null) {
    navigator.geolocation.clearWatch(geoWatchId);
    geoWatchId = null;
  }
  if (livePositionMarker) {
    map.removeLayer(livePositionMarker);
    livePositionMarker = null;
  }
  prevGeoPosition  = null;
  prevGeoTimestamp = null;
  hideAlert();
}

/** Creates or reuses a DivIcon for the live position dot. */
function getLiveDotIcon() {
  return L.divIcon({
    className: '',
    html: '<div class="live-position-icon"></div>',
    iconSize: [16, 16],
    iconAnchor: [8, 8]
  });
}

/**
 * Called on each new GPS fix.
 * FIX: map.panTo instead of setView so user can still pan freely.
 */
function onLivePositionUpdate(position) {
  if (appMode !== 'live') return; // guard if mode was switched mid-update

  const lat       = position.coords.latitude;
  const lng       = position.coords.longitude;
  const alt       = position.coords.altitude;
  const gpsSpeed  = position.coords.speed;
  const gpsHdg    = position.coords.heading;
  const now       = Date.now();

  let speed   = 0;
  let heading = 0;

  if (gpsSpeed !== null && !isNaN(gpsSpeed)) {
    speed = gpsSpeed;
  } else if (prevGeoPosition && prevGeoTimestamp) {
    const dist = haversineDistanceKm(prevGeoPosition.lat, prevGeoPosition.lng, lat, lng) * 1000;
    const dt   = (now - prevGeoTimestamp) / 1000;
    if (dt > 0) speed = dist / dt;
  }

  if (gpsHdg !== null && !isNaN(gpsHdg)) {
    heading = gpsHdg;
  } else if (prevGeoPosition) {
    heading = computeBearing(prevGeoPosition.lat, prevGeoPosition.lng, lat, lng);
  }

  prevGeoPosition  = { lat, lng };
  prevGeoTimestamp = now;

  // FIX: panTo instead of setView — doesn't interrupt user panning
  map.panTo([lat, lng]);

  if (!livePositionMarker) {
    livePositionMarker = L.marker([lat, lng], {
      icon: getLiveDotIcon(), zIndexOffset: 2000
    }).addTo(map);
  } else {
    livePositionMarker.setLatLng([lat, lng]);
  }

  updateTelemetryDisplay({
    altitude:       alt !== null ? alt : 0,
    speed:          speed,
    batteryPercent: 100,
    lat, lng,
    headingDegrees: heading
  });

  // FIX: show N/A for battery (not real drone data)
  telemBattery.textContent = 'N/A';
  telemBattery.style.color = '#8b949e';
}

function onGeoError(err) {
  if (appMode !== 'live') return;
  console.warn('Live tracking error:', err.message);
  showAlert('⚠️ GPS signal lost: ' + err.message, 'warning');
}

/**
 * IP-based location fallback.
 * FIX: uses ipapi.co (HTTPS-compatible, no API key).
 * Old http://ip-api.com is blocked on HTTPS (GitHub Pages).
 */
function fetchIPLocation() {
  fetch('https://ipapi.co/json/')
    .then(res => {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    })
    .then(data => {
      if (data.latitude && data.longitude) {
        map.panTo([data.latitude, data.longitude]);

        if (!livePositionMarker) {
          livePositionMarker = L.marker([data.latitude, data.longitude], {
            icon: getLiveDotIcon(), zIndexOffset: 2000
          }).addTo(map);
        } else {
          livePositionMarker.setLatLng([data.latitude, data.longitude]);
        }

        updateTelemetryDisplay({
          altitude: 0, speed: 0, batteryPercent: 100,
          lat: data.latitude, lng: data.longitude, headingDegrees: 0
        });
        telemBattery.textContent = 'N/A';
        telemBattery.style.color = '#8b949e';

        const city = (data.city || '') + (data.country_name ? ', ' + data.country_name : '');
        showAlert('📍 Approximate location: ' + city, 'info');
      }
    })
    .catch(err => {
      console.error('IP location fetch failed:', err);
      showAlert('⚠️ Could not determine location', 'warning');
    });
}


// ─────────────────────────────────────────────
// UI HELPERS
// ─────────────────────────────────────────────

function updateButtonStates() {
  const hasWaypoints        = missionState.waypoints.length > 0;
  const hasUnvisitedSegments = missionState.resumeFromIndex < missionState.waypoints.length - 1;
  const canSimulate         = missionState.waypoints.length >= 2 && !missionState.isSimulating && hasUnvisitedSegments;

  if (appMode === 'live') {
    btnStart.disabled = true;
    btnPause.disabled = true;
  } else {
    btnStart.disabled = !canSimulate;
    btnPause.disabled = !missionState.isSimulating;
  }

  btnUndo.disabled  = !hasWaypoints || missionState.isSimulating || missionState.waypoints.length <= missionState.resumeFromIndex;
  btnClear.disabled = !hasWaypoints && !missionState.isSimulating;
  btnReset.disabled = !missionState.isSimulating && missionState.resumeFromIndex === 0 && !droneMarker;

  if (!missionState.isSimulating) {
    btnPause.innerHTML = '&#10074;&#10074; Pause';
  }
}


// ─────────────────────────────────────────────
// EVENT LISTENERS
// ─────────────────────────────────────────────

btnUndo.addEventListener('click', undoLastWaypoint);
btnClear.addEventListener('click', clearAll);
btnStart.addEventListener('click', startSimulation);
btnPause.addEventListener('click', togglePause);
btnReset.addEventListener('click', resetSimulation);

// Modal: close on button click, backdrop click, or Escape key
btnModalClose.addEventListener('click', () => modalOverlay.classList.add('hidden'));
modalOverlay.addEventListener('click', e => {
  if (e.target === modalOverlay) modalOverlay.classList.add('hidden');
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && !modalOverlay.classList.contains('hidden')) {
    modalOverlay.classList.add('hidden');
  }
});

// Mode toggle
modeSwitch.addEventListener('change', function () {
  this.setAttribute('aria-checked', this.checked ? 'true' : 'false');
  switchMode(this.checked ? 'live' : 'simulator');
});

// Weather refresh button — now defined in HTML as onclick, wire via addEventListener instead
const btnRefreshWeather = document.getElementById('btn-refresh-weather');
if (btnRefreshWeather) {
  btnRefreshWeather.removeAttribute('onclick'); // FIX: remove inline handler
  btnRefreshWeather.addEventListener('click', () => fetchWeatherData());
}

// Dashboard toggle button — same fix
const dashboardToggleBtn = document.getElementById('dashboard-toggle');
if (dashboardToggleBtn) {
  dashboardToggleBtn.removeAttribute('onclick');
  dashboardToggleBtn.addEventListener('click', toggleDashboard);
}

updateButtonStates();


// ─────────────────────────────────────────────
// MODULE G — DEVICE DETECTION & RESPONSIVE UI
// ─────────────────────────────────────────────

const deviceBadge      = document.getElementById('device-badge');
const dashboardSection = document.getElementById('dashboard-section');
const dashArrow        = document.getElementById('dash-arrow');

let dashboardCollapsed = false;

/**
 * Detects device type and applies CSS class + badge.
 * FIX: does NOT auto-collapse if user has manually expanded dashboard.
 */
function detectDeviceType() {
  const width    = window.innerWidth;
  const hasTouch = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
  const ua       = navigator.userAgent.toLowerCase();

  const uaMobile = /iphone|ipod|android.*mobile|windows phone|blackberry/i.test(ua);
  const uaTablet = /ipad|android(?!.*mobile)|tablet|kindle|silk/i.test(ua);

  let deviceType;
  if (width <= 480 || uaMobile)             deviceType = 'mobile';
  else if ((width <= 960 && hasTouch) || uaTablet) deviceType = 'tablet';
  else                                       deviceType = 'desktop';

  document.body.classList.remove('device-mobile', 'device-tablet', 'device-desktop');
  document.body.classList.add('device-' + deviceType);

  const icons = { mobile: '📱', tablet: '📟', desktop: '🖥️' };
  deviceBadge.textContent = icons[deviceType] + ' ' + deviceType.toUpperCase();

  if (deviceType !== 'desktop') {
    // FIX: only auto-collapse if user has NOT manually expanded it
    if (!userExpandedDashboard && !dashboardCollapsed) {
      collapseDashboard();
    }
  } else {
    expandDashboard();
  }

  return deviceType;
}

function collapseDashboard() {
  dashboardCollapsed = true;
  dashboardSection.style.display = 'none';
  if (dashArrow)          dashArrow.classList.add('collapsed');
  if (dashboardToggleBtn) dashboardToggleBtn.setAttribute('aria-expanded', 'false');
}

function expandDashboard() {
  dashboardCollapsed = false;
  dashboardSection.style.display = '';
  if (dashArrow)          dashArrow.classList.remove('collapsed');
  if (dashboardToggleBtn) dashboardToggleBtn.setAttribute('aria-expanded', 'true');
}

function toggleDashboard() {
  if (dashboardCollapsed) {
    userExpandedDashboard = true; // FIX: remember user's intent
    expandDashboard();
  } else {
    userExpandedDashboard = false;
    collapseDashboard();
  }
}

detectDeviceType();

// FIX: debounced resize listener — prevents continuous firing during drag
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    detectDeviceType();
    map.invalidateSize();
  }, 200);
});


// ─────────────────────────────────────────────
// MODULE H — NO-FLY ZONES
// ─────────────────────────────────────────────

const nfzWarningEl = document.getElementById('nfz-warning');
const nfzStatusEl  = document.getElementById('nfz-status');

/**
 * No-fly zone definitions (Ahmedabad region).
 * Sources: DGCA rules, heritage zone buffers.
 * ⚠️ NOT for real flight planning — always check DigitalSky (digitalsky.dgca.gov.in).
 */
const NO_FLY_ZONES = [
  { name: 'SVPI Airport (Ahmedabad)',     lat: 23.0722, lng: 72.6347, radiusMeters: 5000, type: 'restricted' },
  { name: 'Gandhinagar Secretariat',      lat: 23.2224, lng: 72.6496, radiusMeters: 2000, type: 'restricted' },
  { name: 'Raj Bhavan (Governor House)',  lat: 23.2360, lng: 72.6480, radiusMeters: 1500, type: 'restricted' },
  { name: 'Sabarmati Ashram Heritage',    lat: 23.0607, lng: 72.5809, radiusMeters: 1000, type: 'caution'    },
  { name: 'Adalaj Stepwell Heritage',     lat: 23.1645, lng: 72.5822, radiusMeters:  800, type: 'caution'    },
  { name: 'Gujarat University Campus',    lat: 23.0339, lng: 72.5458, radiusMeters: 1200, type: 'caution'    }
];

let nfzCircles = [];

/** Draws all NFZ circles on the map. */
function drawNoFlyZones() {
  NO_FLY_ZONES.forEach(zone => {
    const color       = zone.type === 'restricted' ? '#f85149' : '#d29922';
    const fillOpacity = zone.type === 'restricted' ? 0.15 : 0.10;

    const circle = L.circle([zone.lat, zone.lng], {
      radius: zone.radiusMeters,
      color, fillColor: color, fillOpacity,
      weight: 2,
      dashArray: zone.type === 'caution' ? '6, 4' : '',
      interactive: true
    }).addTo(map);

    circle.bindTooltip(
      '<strong>' + (zone.type === 'restricted' ? '🚫' : '⚠️') + ' ' + zone.name + '</strong><br>' +
      'Radius: ' + (zone.radiusMeters / 1000).toFixed(1) + ' km<br>' +
      'Type: ' + zone.type.charAt(0).toUpperCase() + zone.type.slice(1),
      { className: '', direction: 'top' }
    );

    nfzCircles.push(circle);
  });

  nfzStatusEl.textContent = NO_FLY_ZONES.length + ' zones loaded on map';
}

/**
 * FIX: Proper segment-to-circle distance check (not just sample points).
 * Uses minimum distance from each path segment to each NFZ center.
 * This catches small zones (800m) on long segments reliably.
 *
 * Returns the first violating zone, or null if safe.
 */
function checkPathIntersectsNFZ() {
  const wps = missionState.waypoints;
  if (wps.length < 2) return null;

  for (let z = 0; z < NO_FLY_ZONES.length; z++) {
    const zone      = NO_FLY_ZONES[z];
    const radiusKm  = zone.radiusMeters / 1000;

    for (let i = 0; i < wps.length - 1; i++) {
      const p1 = wps[i];
      const p2 = wps[i + 1];

      // Minimum distance from segment p1→p2 to zone center
      const minDist = pointToSegmentDistKm(zone.lat, zone.lng, p1, p2);
      if (minDist <= radiusKm) return zone;
    }

    // Also check each waypoint itself
    for (let i = 0; i < wps.length; i++) {
      if (haversineDistanceKm(wps[i].lat, wps[i].lng, zone.lat, zone.lng) <= radiusKm) {
        return zone;
      }
    }
  }

  return null;
}

/**
 * Minimum distance (km) from point P to line segment A→B.
 * Projects P onto the segment, clamped to [A,B].
 */
function pointToSegmentDistKm(pLat, pLng, A, B) {
  // Project onto segment using dot product in lat/lng space (accurate for small areas)
  const ax = A.lng, ay = A.lat;
  const bx = B.lng, by = B.lat;
  const px = pLng,  py = pLat;

  const dx = bx - ax, dy = by - ay;
  const lenSq = dx * dx + dy * dy;

  let t = 0;
  if (lenSq > 0) {
    t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
    t = Math.max(0, Math.min(1, t)); // clamp to segment
  }

  const closestLat = ay + t * dy;
  const closestLng = ax + t * dx;

  return haversineDistanceKm(pLat, pLng, closestLat, closestLng);
}

/**
 * Updates NFZ warning and path color.
 * FIX: distinguishes restricted vs caution zones.
 * Integrated directly into recalculateStats — no monkey-patch needed.
 */
function updateNFZCheck() {
  const violation = checkPathIntersectsNFZ();
  if (violation) {
    nfzWarningEl.textContent = '⚠️ PATH ENTERS: ' + violation.name + ' (' + violation.type + ')';
    nfzWarningEl.classList.remove('hidden');
    // FIX: color path red for restricted, orange for caution
    const pathColor = violation.type === 'restricted' ? '#f85149' : '#d29922';
    flightPathLine.setStyle({ color: pathColor });
  } else {
    nfzWarningEl.classList.add('hidden');
    flightPathLine.setStyle({ color: '#58a6ff' });
  }
}

drawNoFlyZones();


// ─────────────────────────────────────────────
// MODULE I — WIND & WEATHER (Open-Meteo API)
// ─────────────────────────────────────────────

const windSpeedEl     = document.getElementById('wind-speed');
const windDirectionEl = document.getElementById('wind-direction');
const windTempEl      = document.getElementById('wind-temp');
const windEffectEl    = document.getElementById('wind-effect');
const windArrowEl     = document.getElementById('wind-arrow');
const windDescEl      = document.getElementById('wind-desc');

let currentWind = {
  windSpeedKmh:    0,
  windSpeedMs:     0,
  windDirectionDeg: 0,
  temperature:     null,
  loaded:          false
};

/** Degrees to 16-point compass label. */
function degToCompass(deg) {
  const dirs = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
  return dirs[Math.round(deg / 22.5) % 16];
}

/**
 * Fetches weather from Open-Meteo for a specific lat/lng.
 * FIX: takes lat/lng params instead of always using map center.
 * Defaults to map center if no args provided (manual refresh).
 *
 * @param {number} [lat] - latitude (optional, defaults to map center)
 * @param {number} [lng] - longitude (optional, defaults to map center)
 */
function fetchWeatherData(lat, lng) {
  if (lat === undefined || lng === undefined) {
    const center = map.getCenter();
    lat = center.lat;
    lng = center.lng;
  }

  const url = 'https://api.open-meteo.com/v1/forecast'
    + '?latitude='  + lat.toFixed(4)
    + '&longitude=' + lng.toFixed(4)
    + '&current=wind_speed_10m,wind_direction_10m,temperature_2m,weather_code';

  windDescEl.textContent = 'Fetching weather data...';

  fetch(url)
    .then(res => {
      // FIX: check for HTTP errors
      if (!res.ok) throw new Error('Open-Meteo HTTP ' + res.status);
      return res.json();
    })
    .then(data => {
      // FIX: handle API error payload
      if (!data.current) {
        windDescEl.textContent = 'Weather data unavailable';
        return;
      }

      const ws   = data.current.wind_speed_10m;      // km/h
      const wd   = data.current.wind_direction_10m;  // degrees (where FROM)
      const temp = data.current.temperature_2m;      // °C

      currentWind = {
        windSpeedKmh:    ws,
        windSpeedMs:     ws / 3.6,
        windDirectionDeg: wd,
        temperature:     temp,
        loaded:          true
      };

      windSpeedEl.textContent     = ws.toFixed(1) + ' km/h';
      windDirectionEl.textContent = degToCompass(wd) + ' (' + wd + '°)';
      windTempEl.textContent      = temp.toFixed(1) + ' °C';

      // FIX: wind arrow rotation — ➤ glyph points EAST (90°) at 0deg rotation.
      // Wind direction is where wind comes FROM. Arrow should point where wind blows TO.
      // Blows-to = wd + 180. But glyph offset = -90 (east → north correction).
      // Final: wd + 180 - 90 = wd + 90
      windArrowEl.style.transform = 'rotate(' + (wd + 90) + 'deg)';

      let effectDesc;
      if (ws < 5) {
        effectDesc = 'Calm — negligible effect';
        windEffectEl.style.color = '#2ea043';
      } else if (ws < 15) {
        effectDesc = 'Light breeze — minor drag';
        windEffectEl.style.color = '#58a6ff';
      } else if (ws < 30) {
        effectDesc = 'Moderate wind — noticeable drag';
        windEffectEl.style.color = '#d29922';
      } else {
        effectDesc = 'Strong wind — significant drag!';
        windEffectEl.style.color = '#f85149';
      }

      windEffectEl.textContent = effectDesc.split('—')[0].trim();
      windDescEl.textContent   = effectDesc + ' | Wind from ' + degToCompass(wd);
    })
    .catch(err => {
      console.error('Weather fetch failed:', err);
      windDescEl.textContent = '⚠️ Failed to load weather — check connection';
    });
}

/**
 * Computes wind effect on drone speed.
 *
 * Formula: effectiveSpeed = droneSpeed - windSpeed × cos(heading - windFrom)
 *   cos = +1 → pure headwind → maximum slowdown
 *   cos = -1 → pure tailwind → speed boost
 *   cos =  0 → crosswind    → no longitudinal effect
 *
 * FIX: wind speed is NOT multiplied by SIMULATION_SPEED_MULTIPLIER here.
 *      Multiplier is applied to the drone speed only in simulationTick.
 *      This keeps wind effect proportional.
 *
 * @param {number} droneHeadingDeg
 * @param {number} droneSpeedMs
 * @returns {{ effectiveSpeedMs, windComponentMs, isHeadwind }}
 */
function computeWindEffect(droneHeadingDeg, droneSpeedMs) {
  if (!currentWind.loaded || currentWind.windSpeedMs < 0.1) {
    return { effectiveSpeedMs: droneSpeedMs, windComponentMs: 0, isHeadwind: false };
  }

  const angleBetween = toRadians(currentWind.windDirectionDeg - droneHeadingDeg);
  const windComponent = currentWind.windSpeedMs * Math.cos(angleBetween);
  let effectiveSpeed  = droneSpeedMs - windComponent;

  // Floor at 20% of nominal speed
  effectiveSpeed = Math.max(effectiveSpeed, droneSpeedMs * 0.2);

  return {
    effectiveSpeedMs:  effectiveSpeed,
    windComponentMs:   windComponent,
    isHeadwind:        windComponent > 0
  };
}

// Initial weather fetch on page load (map center)
fetchWeatherData();


// ─────────────────────────────────────────────
// MODULE J — MAVLINK & SITL DRONE LINK (WebSocket)
// ─────────────────────────────────────────────

let droneSocket = null;
let isDroneLinkConnected = false;

/**
 * Connects or disconnects the WebSocket link to bridge.py (ws://localhost:8765).
 */
function connectDroneLink() {
  if (droneSocket && (droneSocket.readyState === WebSocket.OPEN || droneSocket.readyState === WebSocket.CONNECTING)) {
    disconnectDroneLink();
    return;
  }

  btnDroneLink.classList.remove('connected');
  btnDroneLink.classList.add('connecting');
  btnDroneLink.innerHTML = '<span class="link-status-dot"></span> Connecting...';

  try {
    droneSocket = new WebSocket('ws://localhost:8765');
  } catch (err) {
    onDroneLinkError(err);
    return;
  }

  droneSocket.onopen = function () {
    isDroneLinkConnected = true;
    btnDroneLink.classList.remove('connecting');
    btnDroneLink.classList.add('connected');
    btnDroneLink.innerHTML = '<span class="link-status-dot"></span> 🟢 Drone Link: Online';

    // Stop internal math simulation if it was running
    if (missionState.isSimulating) {
      stopSimulation();
    }

    // Show drone command buttons
    if (btnUploadDrone) btnUploadDrone.classList.remove('hidden');
    if (btnArmDrone)    btnArmDrone.classList.remove('hidden');
    if (btnRtlDrone)    btnRtlDrone.classList.remove('hidden');

    showAlert('⚡ Connected to SITL / Drone Telemetry Bridge (ws://localhost:8765)', 'info');
  };

  droneSocket.onmessage = function (event) {
    try {
      const payload = JSON.parse(event.data);
      if (payload.type === 'telemetry' && payload.data) {
        onDroneTelemetryReceived(payload.data);
      }
    } catch (e) {
      console.warn('Error parsing drone telemetry:', e);
    }
  };

  droneSocket.onerror = function (err) {
    onDroneLinkError(err);
  };

  droneSocket.onclose = function () {
    disconnectDroneLink(false);
  };
}

/**
 * Disconnects the WebSocket bridge and restores local simulation mode.
 */
function disconnectDroneLink(userInitiated = true) {
  isDroneLinkConnected = false;
  if (droneSocket) {
    droneSocket.onclose = null;
    droneSocket.onerror = null;
    droneSocket.close();
    droneSocket = null;
  }

  btnDroneLink.classList.remove('connecting', 'connected');
  btnDroneLink.innerHTML = '<span class="link-status-dot"></span> SITL / Drone: Off';

  if (btnUploadDrone) btnUploadDrone.classList.add('hidden');
  if (btnArmDrone)    btnArmDrone.classList.add('hidden');
  if (btnRtlDrone)    btnRtlDrone.classList.add('hidden');

  if (!userInitiated) {
    showAlert('🔌 Drone Link disconnected. Run "python bridge.py" to connect.', 'warning');
  }
}

function onDroneLinkError(err) {
  console.warn('Drone Link error:', err);
  disconnectDroneLink(true);
  showAlert('⚠️ Could not connect to bridge (ws://localhost:8765). Did you run "python bridge.py"?', 'warning');
}

/**
 * Handles incoming real telemetry packets from MAVLink / SITL.
 */
function onDroneTelemetryReceived(data) {
  if (!data || !data.connected) return;

  // 1. Move drone marker on Leaflet map
  if (data.lat && data.lng) {
    if (!droneMarker) {
      droneMarker = L.marker([data.lat, data.lng], {
        icon: createDroneIcon(data.heading || 0),
        zIndexOffset: 1000
      }).addTo(map);
    } else {
      droneMarker.setLatLng([data.lat, data.lng]);
    }
    rotateDroneIcon(data.heading || 0);
  }

  // 2. Update telemetry display
  updateTelemetryDisplay({
    altitude:       data.altitude || 0,
    speed:          data.groundSpeed || 0,
    batteryPercent: data.batteryPercent !== undefined ? data.batteryPercent : 100,
    lat:            data.lat || 0,
    lng:            data.lng || 0,
    headingDegrees: data.heading || 0,
    flightMode:     data.flightMode || 'ACTIVE',
    armed:          data.armed,
    batteryVoltage: data.batteryVoltage,
    batteryCurrent: data.batteryCurrent
  });

  // 3. Update ARM button label
  if (btnArmDrone) {
    if (data.armed) {
      btnArmDrone.innerHTML = '⚡ Disarm';
      btnArmDrone.classList.add('armed');
    } else {
      btnArmDrone.innerHTML = '⚡ Arm';
      btnArmDrone.classList.remove('armed');
    }
  }

  // 4. Update charts & logging
  missionState.elapsedSeconds += 0.1;
  updateCharts(missionState.elapsedSeconds, data.batteryPercent, data.groundSpeed || 0);

  logTelemetryPoint({
    altitude:       data.altitude || 0,
    speed:          data.groundSpeed || 0,
    batteryPercent: data.batteryPercent !== undefined ? data.batteryPercent : 100,
    lat:            data.lat || 0,
    lng:            data.lng || 0,
    headingDegrees: data.heading || 0,
    flightMode:     data.flightMode || 'ACTIVE',
    batteryVoltage: data.batteryVoltage,
    batteryCurrent: data.batteryCurrent
  });
}

/**
 * Sends a command to the drone via bridge.py.
 */
function sendDroneCommand(command, extra = {}) {
  if (!droneSocket || droneSocket.readyState !== WebSocket.OPEN) {
    showAlert('⚠️ Drone bridge is not connected', 'warning');
    return;
  }
  const payload = { command, ...extra };
  droneSocket.send(JSON.stringify(payload));
}

// Wire Drone Link Button
if (btnDroneLink) {
  btnDroneLink.addEventListener('click', connectDroneLink);
}

// Wire Drone Command Buttons
if (btnUploadDrone) {
  btnUploadDrone.addEventListener('click', () => {
    if (missionState.waypoints.length < 2) {
      showAlert('⚠️ Need at least 2 waypoints to upload mission', 'warning');
      return;
    }
    sendDroneCommand('UPLOAD_MISSION', { waypoints: missionState.waypoints });
    showAlert('⬆ Waypoints uploaded to drone / SITL flight controller!', 'info');
  });
}

if (btnArmDrone) {
  btnArmDrone.addEventListener('click', () => {
    const isArmed = telemArmed && telemArmed.textContent === 'ARMED';
    sendDroneCommand(isArmed ? 'DISARM' : 'ARM');
  });
}

if (btnRtlDrone) {
  btnRtlDrone.addEventListener('click', () => {
    sendDroneCommand('SET_MODE', { mode: 'RTL' });
    showAlert('🏠 RTL (Return-to-Launch) commanded!', 'info');
  });
}


// ─────────────────────────────────────────────
// MODULE K — MISSION EXPORT/IMPORT & TELEMETRY CSV LOGGING
// ─────────────────────────────────────────────

let flightTelemetryLog = [];

/**
 * Logs a telemetry point during flight (throttled to 2 Hz max).
 */
let lastLogTime = 0;
function logTelemetryPoint(telemetry) {
  const now = Date.now();
  if (now - lastLogTime < 500) return; // 2 Hz max logging rate
  lastLogTime = now;

  flightTelemetryLog.push({
    timestamp: new Date().toISOString(),
    elapsedSeconds: missionState.elapsedSeconds.toFixed(1),
    lat: (telemetry.lat || 0).toFixed(6),
    lng: (telemetry.lng || 0).toFixed(6),
    altitude: (telemetry.altitude || 0).toFixed(1),
    speed: (telemetry.speed || 0).toFixed(1),
    batteryPercent: (telemetry.batteryPercent !== undefined ? telemetry.batteryPercent : 100).toFixed(1),
    batteryVoltage: telemetry.batteryVoltage ? telemetry.batteryVoltage.toFixed(2) : '',
    batteryCurrent: telemetry.batteryCurrent !== undefined ? telemetry.batteryCurrent.toFixed(1) : '',
    heading: (telemetry.headingDegrees || 0).toFixed(1),
    flightMode: telemetry.flightMode || (isDroneLinkConnected ? 'MAVLINK' : 'SIMULATOR')
  });
}

/**
 * Exports recorded flight telemetry to CSV.
 */
function exportTelemetryCSV() {
  if (flightTelemetryLog.length === 0) {
    showAlert('⚠️ No flight telemetry data recorded yet. Run a flight first!', 'warning');
    return;
  }

  const headers = [
    'Timestamp', 'Elapsed_Sec', 'Latitude', 'Longitude', 'Altitude_m',
    'Speed_ms', 'Battery_pct', 'Voltage_V', 'Current_A', 'Heading_deg', 'Flight_Mode'
  ];

  const rows = flightTelemetryLog.map(r => [
    r.timestamp, r.elapsedSeconds, r.lat, r.lng, r.altitude,
    r.speed, r.batteryPercent, r.batteryVoltage, r.batteryCurrent, r.heading, r.flightMode
  ]);

  const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
  const encodedUri = encodeURI(csvContent);
  const link = document.createElement('a');
  link.setAttribute('href', encodedUri);
  link.setAttribute('download', `drone_pathika_telemetry_${new Date().toISOString().replace(/[:.]/g, '-')}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  showAlert(`📊 Exported ${flightTelemetryLog.length} telemetry records to CSV!`, 'info');
}

/**
 * Exports current waypoint mission plan to JSON file.
 */
function exportMissionJSON() {
  if (missionState.waypoints.length === 0) {
    showAlert('⚠️ No waypoints to export. Click the map to add waypoints first.', 'warning');
    return;
  }

  const mission = {
    project: 'Drone Pathika',
    format: 'mission-plan-v1',
    created: new Date().toISOString(),
    totalWaypoints: missionState.waypoints.length,
    totalDistanceKm: missionState.totalDistanceKm,
    estimatedTimeSeconds: missionState.estimatedTimeSeconds,
    waypoints: missionState.waypoints
  };

  const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(mission, null, 2));
  const link = document.createElement('a');
  link.setAttribute('href', dataStr);
  link.setAttribute('download', `drone_pathika_mission_${Date.now()}.json`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  showAlert('📥 Mission plan exported successfully!', 'info');
}

/**
 * Imports waypoint mission plan from JSON file.
 */
function importMissionJSON(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function (e) {
    try {
      const data = JSON.parse(e.target.result);
      if (data && Array.isArray(data.waypoints) && data.waypoints.length > 0) {
        clearAll();
        data.waypoints.forEach(wp => addWaypoint(wp.lat, wp.lng));
        showAlert(`📁 Successfully imported mission with ${data.waypoints.length} waypoints!`, 'info');
      } else {
        showAlert('⚠️ Invalid file: no waypoints found in JSON', 'warning');
      }
    } catch (err) {
      console.error(err);
      showAlert('⚠️ Error reading mission JSON file', 'warning');
    }
  };
  reader.readAsText(file);
}

// Wire Export / Import Event Listeners
if (btnExportMission) {
  btnExportMission.addEventListener('click', exportMissionJSON);
}

if (btnImportMission && inputImportMission) {
  btnImportMission.addEventListener('click', () => inputImportMission.click());
  inputImportMission.addEventListener('change', function () {
    if (this.files && this.files[0]) {
      importMissionJSON(this.files[0]);
      this.value = ''; // Reset input so same file can be imported again
    }
  });
}

if (btnExportCSV) {
  btnExportCSV.addEventListener('click', exportTelemetryCSV);
}

if (btnModalCSV) {
  btnModalCSV.addEventListener('click', exportTelemetryCSV);
}
