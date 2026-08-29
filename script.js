/* ===================================================
   SCRIPT.JS — Drone Pathika: Mission Planner & Flight Dashboard
   ===================================================
   This single file contains all application logic:
     - Map & Waypoint Management  (Module A)
     - Path Stats Calculator      (Module B)
     - Simulation Engine           (Module C)  — with resume support
     - Telemetry Dashboard         (Module D)
     - Alerts                      (Module E)
     - Live Tracking Mode          (Module F)

   Dependencies (loaded via CDN in index.html):
     - Leaflet.js   → window.L
     - Chart.js     → window.Chart
   =================================================== */

// ─────────────────────────────────────────────
// CONFIGURATION CONSTANTS
// ─────────────────────────────────────────────

/** Assumed drone cruise speed in km/h (used for ETA and simulation) */
const ASSUMED_SPEED_KMH = 36;

/** Assumed drone cruise speed in m/s (derived from above) */
const ASSUMED_SPEED_MS = ASSUMED_SPEED_KMH / 3.6; // 10 m/s

/** Battery drain rate: percent consumed per kilometer traveled */
const BATTERY_PER_KM = 5;

/** Baseline simulated altitude in meters */
const ALTITUDE_BASELINE = 50;

/** Random altitude fluctuation range (±) in meters */
const ALTITUDE_JITTER = 5;

/** Simulation tick interval in milliseconds */
const TICK_INTERVAL_MS = 100;

/** Speed multiplier — increase to make the drone fly faster in simulation.
 *  1 = real-time based on ASSUMED_SPEED_MS. Higher = faster animation. */
const SIMULATION_SPEED_MULTIPLIER = 3;

/** Default map center (Ahmedabad, India) */
const DEFAULT_CENTER = [23.2156, 72.6369];

/** Default map zoom level */
const DEFAULT_ZOOM = 13;

/** How many data points to keep on the live charts before scrolling */
const CHART_MAX_POINTS = 200;


// ─────────────────────────────────────────────
// APPLICATION STATE
// ─────────────────────────────────────────────

/**
 * missionState holds all the data for the current mission.
 * It is reset when the user clicks "Clear All" or "Reset".
 */
let missionState = {
  waypoints: [],                // Array of {lat, lng} objects
  totalDistanceKm: 0,          // Sum of all segment distances
  estimatedTimeSeconds: 0,     // totalDistanceKm / speed
  estimatedBatteryPercent: 0,  // totalDistanceKm * BATTERY_PER_KM (capped at 100)
  isSimulating: false,         // True while the simulation is running
  isPaused: false,             // True while the simulation is paused
  currentSegmentIndex: 0,      // Which leg of the path the drone is on
  segmentProgress: 0,          // 0 to 1, how far along the current leg
  distanceCoveredKm: 0,        // Total distance the drone has traveled so far
  elapsedSeconds: 0,           // Elapsed simulation time in seconds
  resumeFromIndex: 0,          // Waypoint index to resume simulation from (for continuing missions)
  currentHeading: 0            // Current heading in degrees (for icon rotation)
};

/** Current app mode: 'simulator' or 'live' */
let appMode = 'simulator';

/** Stores the setInterval timer ID for the simulation loop */
let simTimerId = null;

/** Geolocation watch ID for live tracking mode */
let geoWatchId = null;

/** Leaflet marker for live GPS position */
let livePositionMarker = null;

/** Previous GPS position for computing heading/speed in live mode */
let prevGeoPosition = null;

/** Timestamp of the previous GPS position update */
let prevGeoTimestamp = null;


// ─────────────────────────────────────────────
// DOM ELEMENT REFERENCES
// ─────────────────────────────────────────────

const btnUndo    = document.getElementById('btn-undo');
const btnClear   = document.getElementById('btn-clear');
const btnStart   = document.getElementById('btn-start');
const btnPause   = document.getElementById('btn-pause');
const btnReset   = document.getElementById('btn-reset');

const statDistance = document.getElementById('stat-distance');
const statTime    = document.getElementById('stat-time');
const statBattery = document.getElementById('stat-battery');

const telemAltitude = document.getElementById('telem-altitude');
const telemSpeed    = document.getElementById('telem-speed');
const telemBattery  = document.getElementById('telem-battery');
const telemLat      = document.getElementById('telem-lat');
const telemLng      = document.getElementById('telem-lng');
const telemHeading  = document.getElementById('telem-heading');

const alertBanner       = document.getElementById('alert-banner');
const modalOverlay      = document.getElementById('modal-overlay');
const btnModalClose     = document.getElementById('btn-modal-close');
const modeSwitch        = document.getElementById('mode-switch');
const modeLabelSim      = document.getElementById('mode-label-sim');
const modeLabelLive     = document.getElementById('mode-label-live');
const liveStatusBanner  = document.getElementById('live-status-banner');


// ─────────────────────────────────────────────
// MODULE A — MAP & WAYPOINT MANAGEMENT
// ─────────────────────────────────────────────

/** Initialize the Leaflet map centered on the default location */
const map = L.map('map').setView(DEFAULT_CENTER, DEFAULT_ZOOM);

// Add OpenStreetMap tile layer (free, no API key needed)
// Must be served via a local HTTP server to avoid referer issues with file://
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  maxZoom: 19
}).addTo(map);

/** Array of Leaflet marker objects for waypoints (parallel to missionState.waypoints) */
let waypointMarkers = [];

/** Leaflet polyline connecting all waypoints */
let flightPathLine = L.polyline([], { color: '#58a6ff', weight: 3, dashArray: '8, 6' }).addTo(map);

/** Leaflet marker for the animated drone */
let droneMarker = null;

/**
 * Creates a numbered DivIcon for a waypoint marker.
 * @param {number} number — The waypoint number (1-based)
 * @param {boolean} reached — Whether the drone has reached this waypoint
 * @returns {L.DivIcon}
 */
function createWaypointIcon(number, reached) {
  const reachedClass = reached ? ' reached' : '';
  return L.divIcon({
    className: '',  // remove default Leaflet class
    html: '<div class="waypoint-icon' + reachedClass + '">' + number + '</div>',
    iconSize: [28, 28],
    iconAnchor: [14, 14]
  });
}

/**
 * Creates the drone DivIcon — an SVG arrow pointing north (up).
 * Rotation is applied via CSS transform on the inner element.
 * @param {number} heading — Heading in degrees (0 = north)
 * @returns {L.DivIcon}
 */
function createDroneIcon(heading) {
  return L.divIcon({
    className: '',
    html: '<div class="drone-icon" style="transform: rotate(' + (heading || 0) + 'deg)">' +
          '<svg viewBox="0 0 32 32" width="30" height="30">' +
          '<polygon points="16,2 6,28 16,22 26,28" fill="#00e676" stroke="#0d1117" stroke-width="1.5"/>' +
          '</svg>' +
          '</div>',
    iconSize: [30, 30],
    iconAnchor: [15, 15]
  });
}

/**
 * Rotates the drone marker icon to match the current heading.
 * Updates the CSS transform on the inner .drone-icon element directly
 * for smooth rotation without recreating the icon.
 * @param {number} heading — Heading in degrees (0 = north)
 */
function rotateDroneIcon(heading) {
  if (!droneMarker) return;
  const el = droneMarker.getElement();
  if (el) {
    const iconEl = el.querySelector('.drone-icon');
    if (iconEl) {
      iconEl.style.transform = 'rotate(' + heading + 'deg)';
    }
  }
}

/**
 * Adds a waypoint at the given lat/lng position.
 * Called when the user clicks on the map.
 */
function addWaypoint(lat, lng) {
  // Don't allow new waypoints during an active simulation
  if (missionState.isSimulating) return;

  // Store the waypoint in mission state
  missionState.waypoints.push({ lat, lng });

  // Create a numbered marker and add it to the map
  // Mark waypoints before resumeFromIndex as "reached"
  const num = missionState.waypoints.length;
  const idx = num - 1;
  const reached = idx < missionState.resumeFromIndex;
  const marker = L.marker([lat, lng], { icon: createWaypointIcon(num, reached) }).addTo(map);
  waypointMarkers.push(marker);

  // Redraw the flight path line and recalculate stats
  updateFlightPath();
  recalculateStats();
  updateButtonStates();
}

/**
 * Removes the last waypoint from the mission.
 * Cannot undo past the resume point (already-visited waypoints are locked).
 */
function undoLastWaypoint() {
  if (missionState.isSimulating || missionState.waypoints.length === 0) return;

  // Don't allow undoing past the resume point
  if (missionState.waypoints.length <= missionState.resumeFromIndex) return;

  // Remove from state
  missionState.waypoints.pop();

  // Remove the marker from the map
  const marker = waypointMarkers.pop();
  map.removeLayer(marker);

  // Redraw the flight path and recalculate
  updateFlightPath();
  recalculateStats();
  updateButtonStates();
}

/**
 * Clears all waypoints and resets the entire mission to a blank state.
 */
function clearAll() {
  // Stop any running simulation first
  stopSimulation();

  // Remove all waypoint markers from the map
  waypointMarkers.forEach(function (m) { map.removeLayer(m); });
  waypointMarkers = [];

  // Remove the drone marker if it exists
  if (droneMarker) {
    map.removeLayer(droneMarker);
    droneMarker = null;
  }

  // Reset state
  missionState = {
    waypoints: [],
    totalDistanceKm: 0,
    estimatedTimeSeconds: 0,
    estimatedBatteryPercent: 0,
    isSimulating: false,
    isPaused: false,
    currentSegmentIndex: 0,
    segmentProgress: 0,
    distanceCoveredKm: 0,
    elapsedSeconds: 0,
    resumeFromIndex: 0,
    currentHeading: 0
  };

  // Redraw and recalculate
  updateFlightPath();
  recalculateStats();
  resetTelemetryDisplay();
  resetCharts();
  hideAlert();
  updateButtonStates();
}

/**
 * Redraws the polyline connecting all waypoints.
 */
function updateFlightPath() {
  var latlngs = missionState.waypoints.map(function (wp) { return [wp.lat, wp.lng]; });
  flightPathLine.setLatLngs(latlngs);
}

/**
 * Marks waypoints up to the given index as "reached" (turns them green).
 * @param {number} upToIndex — Mark waypoints 0..upToIndex as reached
 */
function markWaypointsReached(upToIndex) {
  for (var i = 0; i <= upToIndex && i < waypointMarkers.length; i++) {
    waypointMarkers[i].setIcon(createWaypointIcon(i + 1, true));
  }
}

/** Handle map click events — add a waypoint */
map.on('click', function (e) {
  addWaypoint(e.latlng.lat, e.latlng.lng);
});


// ─────────────────────────────────────────────
// MODULE B — PATH STATS CALCULATOR
// ─────────────────────────────────────────────

/**
 * Computes the great-circle distance between two lat/lng points
 * using the Haversine formula.
 * @param {number} lat1 — Latitude of point 1 (degrees)
 * @param {number} lng1 — Longitude of point 1 (degrees)
 * @param {number} lat2 — Latitude of point 2 (degrees)
 * @param {number} lng2 — Longitude of point 2 (degrees)
 * @returns {number} Distance in kilometers
 */
function haversineDistanceKm(lat1, lng1, lat2, lng2) {
  var R = 6371; // Earth's radius in km
  var dLat = toRadians(lat2 - lat1);
  var dLng = toRadians(lng2 - lng1);
  var a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/** Converts degrees to radians */
function toRadians(deg) {
  return deg * (Math.PI / 180);
}

/**
 * Computes the bearing (heading) from point 1 to point 2.
 * @returns {number} Bearing in degrees (0–360, where 0 = North)
 */
function computeBearing(lat1, lng1, lat2, lng2) {
  var dLng = toRadians(lng2 - lng1);
  var y = Math.sin(dLng) * Math.cos(toRadians(lat2));
  var x =
    Math.cos(toRadians(lat1)) * Math.sin(toRadians(lat2)) -
    Math.sin(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.cos(dLng);
  var brng = Math.atan2(y, x);
  brng = ((brng * 180) / Math.PI + 360) % 360; // normalize to 0–360
  return brng;
}

/**
 * Computes the distance of each segment between consecutive waypoints.
 * @returns {number[]} Array of distances in km (one per segment)
 */
function computeSegmentDistances() {
  var distances = [];
  for (var i = 0; i < missionState.waypoints.length - 1; i++) {
    var wp1 = missionState.waypoints[i];
    var wp2 = missionState.waypoints[i + 1];
    distances.push(haversineDistanceKm(wp1.lat, wp1.lng, wp2.lat, wp2.lng));
  }
  return distances;
}

/**
 * Recalculates total distance, estimated flight time, and battery use,
 * then updates the stats panel in the UI.
 */
function recalculateStats() {
  var segments = computeSegmentDistances();
  var totalDist = segments.reduce(function (sum, d) { return sum + d; }, 0);

  missionState.totalDistanceKm = totalDist;
  missionState.estimatedTimeSeconds = (totalDist / ASSUMED_SPEED_KMH) * 3600;
  missionState.estimatedBatteryPercent = Math.min(totalDist * BATTERY_PER_KM, 100);

  // Update the stats panel UI
  statDistance.textContent = totalDist.toFixed(2) + ' km';

  var mins = Math.floor(missionState.estimatedTimeSeconds / 60);
  var secs = Math.floor(missionState.estimatedTimeSeconds % 60);
  statTime.textContent = mins + 'm ' + secs + 's';

  statBattery.textContent = missionState.estimatedBatteryPercent.toFixed(1) + ' %';
}


// ─────────────────────────────────────────────
// MODULE D — TELEMETRY DASHBOARD & CHARTS
// ─────────────────────────────────────────────

/**
 * Initializes the two Chart.js line charts: Battery % and Speed over time.
 */
function initCharts() {
  // Common chart options for the dark theme
  var commonOptions = {
    responsive: true,
    maintainAspectRatio: true,
    animation: false, // disable animation for real-time performance
    scales: {
      x: {
        title: { display: true, text: 'Time (s)', color: '#8b949e' },
        ticks: { color: '#8b949e', maxTicksLimit: 10 },
        grid: { color: '#21262d' }
      },
      y: {
        ticks: { color: '#8b949e' },
        grid: { color: '#21262d' }
      }
    },
    plugins: {
      legend: { display: false }
    },
    elements: {
      point: { radius: 0 },
      line: { borderWidth: 2 }
    }
  };

  // Battery chart
  var bChart = new Chart(document.getElementById('chart-battery'), {
    type: 'line',
    data: {
      labels: [],
      datasets: [{
        label: 'Battery %',
        data: [],
        borderColor: '#f0883e',
        backgroundColor: 'rgba(240, 136, 62, 0.1)',
        fill: true,
        tension: 0.2
      }]
    },
    options: {
      ...commonOptions,
      scales: {
        ...commonOptions.scales,
        y: {
          ...commonOptions.scales.y,
          min: 0,
          max: 100,
          title: { display: true, text: 'Battery %', color: '#8b949e' }
        }
      }
    }
  });

  // Speed chart
  var sChart = new Chart(document.getElementById('chart-speed'), {
    type: 'line',
    data: {
      labels: [],
      datasets: [{
        label: 'Speed (m/s)',
        data: [],
        borderColor: '#58a6ff',
        backgroundColor: 'rgba(88, 166, 255, 0.1)',
        fill: true,
        tension: 0.2
      }]
    },
    options: {
      ...commonOptions,
      scales: {
        ...commonOptions.scales,
        y: {
          ...commonOptions.scales.y,
          min: 0,
          title: { display: true, text: 'Speed (m/s)', color: '#8b949e' }
        }
      }
    }
  });

  return { batteryChart: bChart, speedChart: sChart };
}

// Create charts on page load
var charts = initCharts();
var batteryChart = charts.batteryChart;
var speedChart = charts.speedChart;

/**
 * Adds a data point to both live charts.
 */
function updateCharts(timeSec, battery, speed) {
  var timeLabel = timeSec.toFixed(1);

  batteryChart.data.labels.push(timeLabel);
  batteryChart.data.datasets[0].data.push(battery);
  speedChart.data.labels.push(timeLabel);
  speedChart.data.datasets[0].data.push(speed);

  // Cap chart data length to prevent performance issues
  if (batteryChart.data.labels.length > CHART_MAX_POINTS) {
    batteryChart.data.labels.shift();
    batteryChart.data.datasets[0].data.shift();
    speedChart.data.labels.shift();
    speedChart.data.datasets[0].data.shift();
  }

  batteryChart.update();
  speedChart.update();
}

/** Clears all data from both charts. */
function resetCharts() {
  batteryChart.data.labels = [];
  batteryChart.data.datasets[0].data = [];
  speedChart.data.labels = [];
  speedChart.data.datasets[0].data = [];
  batteryChart.update();
  speedChart.update();
}

/** Updates the telemetry readout panel with the current values. */
function updateTelemetryDisplay(telemetry) {
  telemAltitude.textContent = telemetry.altitude.toFixed(1) + ' m';
  telemSpeed.textContent    = telemetry.speed.toFixed(1) + ' m/s';
  telemBattery.textContent  = telemetry.batteryPercent.toFixed(1) + ' %';
  telemLat.textContent      = telemetry.lat.toFixed(6);
  telemLng.textContent      = telemetry.lng.toFixed(6);
  telemHeading.textContent  = telemetry.headingDegrees.toFixed(1) + ' °';

  // Color the battery value based on level
  if (telemetry.batteryPercent <= 20) {
    telemBattery.style.color = '#f85149'; // red
  } else if (telemetry.batteryPercent <= 50) {
    telemBattery.style.color = '#f0883e'; // orange
  } else {
    telemBattery.style.color = '#00e676'; // green
  }
}

/** Resets the telemetry readout to placeholder values. */
function resetTelemetryDisplay() {
  telemAltitude.textContent = '-- m';
  telemSpeed.textContent    = '-- m/s';
  telemBattery.textContent  = '-- %';
  telemLat.textContent      = '--';
  telemLng.textContent      = '--';
  telemHeading.textContent  = '-- °';
  telemBattery.style.color  = '#e6edf3';
}


// ─────────────────────────────────────────────
// MODULE C — SIMULATION ENGINE (with resume)
// ─────────────────────────────────────────────

/** Precomputed segment distances (km) — set when simulation starts */
var segmentDistances = [];

/** Total path distance (km) */
var totalPathDistanceKm = 0;

/**
 * Starts (or resumes) the flight simulation.
 * If waypoints were added after a completed mission, the drone continues
 * from where it left off instead of restarting from waypoint 1.
 */
function startSimulation() {
  var wps = missionState.waypoints;

  // Need at least one segment ahead of the resume point
  if (missionState.resumeFromIndex >= wps.length - 1) return;
  if (wps.length < 2) return;

  // Compute segment distances for the entire path
  segmentDistances = computeSegmentDistances();
  totalPathDistanceKm = segmentDistances.reduce(function (s, d) { return s + d; }, 0);

  // Calculate distance already covered (sum of segments before resumeFromIndex)
  var alreadyCovered = 0;
  for (var i = 0; i < missionState.resumeFromIndex; i++) {
    alreadyCovered += segmentDistances[i];
  }

  // Set simulation state — start from the resume point, not from 0
  missionState.isSimulating = true;
  missionState.isPaused = false;
  missionState.currentSegmentIndex = missionState.resumeFromIndex;
  missionState.segmentProgress = 0;
  missionState.distanceCoveredKm = alreadyCovered;
  // Keep elapsedSeconds continuous if resuming, reset if fresh
  if (missionState.resumeFromIndex === 0) {
    missionState.elapsedSeconds = 0;
    resetCharts();
  }

  hideAlert();

  // Create or move the drone marker to the resume waypoint
  var startWp = wps[missionState.resumeFromIndex];
  var nextWp = wps[missionState.resumeFromIndex + 1];
  var initialHeading = computeBearing(startWp.lat, startWp.lng, nextWp.lat, nextWp.lng);
  missionState.currentHeading = initialHeading;

  if (droneMarker) {
    droneMarker.setLatLng([startWp.lat, startWp.lng]);
    droneMarker.setIcon(createDroneIcon(initialHeading));
  } else {
    droneMarker = L.marker([startWp.lat, startWp.lng], {
      icon: createDroneIcon(initialHeading),
      zIndexOffset: 1000
    }).addTo(map);
  }

  // Mark already-visited waypoints as reached
  markWaypointsReached(missionState.resumeFromIndex);

  updateButtonStates();

  // Start the simulation loop
  simTimerId = setInterval(simulationTick, TICK_INTERVAL_MS);
}

/**
 * A single tick of the simulation loop.
 * Advances the drone along the path, computes telemetry, and updates the UI.
 */
function simulationTick() {
  if (missionState.isPaused) return;

  var wps = missionState.waypoints;
  var segIdx = missionState.currentSegmentIndex;

  // Safety: if we're past the last segment, stop
  if (segIdx >= segmentDistances.length) {
    missionComplete();
    return;
  }

  // --- Advance position ---

  var speedKmPerSec = ASSUMED_SPEED_KMH / 3600;
  var tickDurationSec = TICK_INTERVAL_MS / 1000;
  var distThisTick = speedKmPerSec * tickDurationSec * SIMULATION_SPEED_MULTIPLIER;

  var currentSegLen = segmentDistances[segIdx]; // km
  var progressIncrement = currentSegLen > 0 ? distThisTick / currentSegLen : 1;

  missionState.segmentProgress += progressIncrement;
  missionState.distanceCoveredKm += distThisTick;
  missionState.elapsedSeconds += tickDurationSec;

  // Check if we've finished the current segment
  if (missionState.segmentProgress >= 1) {
    var overshoot = missionState.segmentProgress - 1;

    // Mark the reached waypoint
    markWaypointsReached(segIdx + 1);

    missionState.currentSegmentIndex++;

    // If that was the last segment, mission complete!
    if (missionState.currentSegmentIndex >= segmentDistances.length) {
      var lastWp = wps[wps.length - 1];
      droneMarker.setLatLng([lastWp.lat, lastWp.lng]);
      missionComplete();
      return;
    }

    // Carry overshoot into the next segment
    missionState.segmentProgress = 0;
    var nextSegLen = segmentDistances[missionState.currentSegmentIndex];
    if (nextSegLen > 0) {
      missionState.segmentProgress = (overshoot * currentSegLen) / nextSegLen;
    }
  }

  // --- Compute interpolated position ---
  var newSegIdx = missionState.currentSegmentIndex;
  var wpA = wps[newSegIdx];
  var wpB = wps[newSegIdx + 1];
  var t = missionState.segmentProgress;

  var currentLat = wpA.lat + (wpB.lat - wpA.lat) * t;
  var currentLng = wpA.lng + (wpB.lng - wpA.lng) * t;

  // Move the drone marker
  droneMarker.setLatLng([currentLat, currentLng]);

  // --- Compute telemetry ---
  var battery = Math.max(0, 100 - (missionState.distanceCoveredKm * BATTERY_PER_KM));
  var altitude = ALTITUDE_BASELINE + (Math.random() * 2 - 1) * ALTITUDE_JITTER;
  var speed = ASSUMED_SPEED_MS + (Math.random() * 2 - 1) * 1.5;
  var heading = computeBearing(currentLat, currentLng, wpB.lat, wpB.lng);

  // Rotate the drone icon to match heading
  missionState.currentHeading = heading;
  rotateDroneIcon(heading);

  var telemetry = {
    altitude: altitude,
    speed: Math.max(0, speed),
    batteryPercent: battery,
    lat: currentLat,
    lng: currentLng,
    headingDegrees: heading
  };

  updateTelemetryDisplay(telemetry);
  updateCharts(missionState.elapsedSeconds, battery, telemetry.speed);

  // --- Check alerts ---
  if (battery <= 20) {
    showAlert('⚠️ LOW BATTERY WARNING — ' + battery.toFixed(1) + '%', 'warning');
  }
}

/**
 * Called when the drone reaches the final waypoint.
 * Sets resumeFromIndex so the user can add more waypoints and continue.
 */
function missionComplete() {
  stopSimulation();

  // Set resume point to the last waypoint so user can extend the mission
  missionState.resumeFromIndex = missionState.waypoints.length - 1;

  // Final telemetry snapshot at destination
  var lastWp = missionState.waypoints[missionState.waypoints.length - 1];
  var finalBattery = Math.max(0, 100 - (missionState.distanceCoveredKm * BATTERY_PER_KM));
  updateTelemetryDisplay({
    altitude: ALTITUDE_BASELINE,
    speed: 0,
    batteryPercent: finalBattery,
    lat: lastWp.lat,
    lng: lastWp.lng,
    headingDegrees: missionState.currentHeading
  });

  // Show the mission complete modal
  modalOverlay.classList.remove('hidden');
}

/** Stops the simulation timer and resets the isSimulating flag. */
function stopSimulation() {
  if (simTimerId !== null) {
    clearInterval(simTimerId);
    simTimerId = null;
  }
  missionState.isSimulating = false;
  missionState.isPaused = false;
  updateButtonStates();
}

/** Pauses or resumes the simulation. */
function togglePause() {
  if (!missionState.isSimulating) return;
  missionState.isPaused = !missionState.isPaused;
  btnPause.innerHTML = missionState.isPaused ? '&#9654; Resume' : '&#10074;&#10074; Pause';
}

/**
 * Resets the simulation fully: stops animation, removes drone,
 * clears resume point, keeping waypoints intact for re-run from scratch.
 */
function resetSimulation() {
  stopSimulation();

  // Remove drone marker
  if (droneMarker) {
    map.removeLayer(droneMarker);
    droneMarker = null;
  }

  // Reset sim state AND resume point (full restart)
  missionState.currentSegmentIndex = 0;
  missionState.segmentProgress = 0;
  missionState.distanceCoveredKm = 0;
  missionState.elapsedSeconds = 0;
  missionState.resumeFromIndex = 0;
  missionState.currentHeading = 0;

  // Reset reached waypoints back to blue
  for (var i = 0; i < waypointMarkers.length; i++) {
    waypointMarkers[i].setIcon(createWaypointIcon(i + 1, false));
  }

  resetTelemetryDisplay();
  resetCharts();
  hideAlert();
  updateButtonStates();
}


// ─────────────────────────────────────────────
// MODULE E — ALERTS
// ─────────────────────────────────────────────

/** Shows an alert banner with the given message and CSS class. */
function showAlert(message, type) {
  alertBanner.textContent = message;
  alertBanner.className = type;
}

/** Hides the alert banner. */
function hideAlert() {
  alertBanner.className = 'hidden';
  alertBanner.textContent = '';
}


// ─────────────────────────────────────────────
// MODULE F — LIVE TRACKING MODE
// ─────────────────────────────────────────────

/**
 * Switches the app between 'simulator' and 'live' modes.
 * In live mode, the user's real GPS position is shown on the map
 * and telemetry is fed from the browser's Geolocation API.
 */
function switchMode(mode) {
  // Stop any running simulation when switching modes
  if (missionState.isSimulating) {
    stopSimulation();
  }

  appMode = mode;

  if (mode === 'live') {
    // --- ENTERING LIVE MODE ---
    modeLabelSim.classList.remove('active');
    modeLabelLive.classList.add('active');
    liveStatusBanner.classList.remove('hidden');

    // Disable simulation controls in live mode
    btnStart.disabled = true;
    btnPause.disabled = true;

    // Start watching the user's GPS position
    startLiveTracking();
  } else {
    // --- ENTERING SIMULATOR MODE ---
    modeLabelLive.classList.remove('active');
    modeLabelSim.classList.add('active');
    liveStatusBanner.classList.add('hidden');

    // Stop watching GPS
    stopLiveTracking();

    // Re-enable controls
    updateButtonStates();
  }
}

/**
 * Begins live GPS tracking using the browser's Geolocation API.
 * Falls back to IP-based location if geolocation is denied.
 */
function startLiveTracking() {
  if (!navigator.geolocation) {
    showAlert('⚠️ Geolocation not supported — falling back to IP location', 'warning');
    fetchIPLocation();
    return;
  }

  // Request high-accuracy GPS position
  navigator.geolocation.getCurrentPosition(
    function (pos) {
      // Success — start watching
      onLivePositionUpdate(pos);
      geoWatchId = navigator.geolocation.watchPosition(
        onLivePositionUpdate,
        onGeoError,
        { enableHighAccuracy: true, maximumAge: 2000, timeout: 10000 }
      );
    },
    function (err) {
      // Permission denied or error — fall back to IP location
      console.warn('Geolocation error:', err.message);
      showAlert('📍 GPS unavailable — using approximate IP location', 'warning');
      fetchIPLocation();
    },
    { enableHighAccuracy: true, timeout: 10000 }
  );
}

/**
 * Stops the live GPS watcher and removes the live position marker.
 */
function stopLiveTracking() {
  if (geoWatchId !== null) {
    navigator.geolocation.clearWatch(geoWatchId);
    geoWatchId = null;
  }

  if (livePositionMarker) {
    map.removeLayer(livePositionMarker);
    livePositionMarker = null;
  }

  prevGeoPosition = null;
  prevGeoTimestamp = null;
  hideAlert();
}

/**
 * Called each time the browser provides a new GPS position in live mode.
 * Updates the map, telemetry, and charts with real data.
 */
function onLivePositionUpdate(position) {
  var lat = position.coords.latitude;
  var lng = position.coords.longitude;
  var alt = position.coords.altitude; // may be null
  var gpsSpeed = position.coords.speed; // may be null (m/s)
  var gpsHeading = position.coords.heading; // may be null

  // Compute speed and heading from previous position if GPS doesn't provide them
  var speed = 0;
  var heading = 0;
  var now = Date.now();

  if (gpsSpeed !== null && !isNaN(gpsSpeed)) {
    speed = gpsSpeed;
  } else if (prevGeoPosition && prevGeoTimestamp) {
    var dist = haversineDistanceKm(prevGeoPosition.lat, prevGeoPosition.lng, lat, lng) * 1000; // meters
    var dt = (now - prevGeoTimestamp) / 1000; // seconds
    if (dt > 0) speed = dist / dt;
  }

  if (gpsHeading !== null && !isNaN(gpsHeading)) {
    heading = gpsHeading;
  } else if (prevGeoPosition) {
    heading = computeBearing(prevGeoPosition.lat, prevGeoPosition.lng, lat, lng);
  }

  prevGeoPosition = { lat: lat, lng: lng };
  prevGeoTimestamp = now;

  // Center map on current position
  map.setView([lat, lng], map.getZoom());

  // Create or move the live position marker
  if (!livePositionMarker) {
    livePositionMarker = L.marker([lat, lng], {
      icon: L.divIcon({
        className: '',
        html: '<div class="live-position-icon"></div>',
        iconSize: [16, 16],
        iconAnchor: [8, 8]
      }),
      zIndexOffset: 2000
    }).addTo(map);
  } else {
    livePositionMarker.setLatLng([lat, lng]);
  }

  // Update telemetry display with real GPS data
  updateTelemetryDisplay({
    altitude: alt !== null ? alt : 0,
    speed: speed,
    batteryPercent: 100, // No battery data from GPS — show 100
    lat: lat,
    lng: lng,
    headingDegrees: heading
  });

  // In live mode, show N/A style for battery since it's not real drone data
  telemBattery.textContent = 'N/A';
  telemBattery.style.color = '#8b949e';
}

/**
 * Handles geolocation errors.
 */
function onGeoError(err) {
  console.warn('Live tracking error:', err.message);
  showAlert('⚠️ GPS signal lost: ' + err.message, 'warning');
}

/**
 * Fallback: Fetches approximate location based on IP address.
 * Uses the free ip-api.com service (no key required).
 */
function fetchIPLocation() {
  fetch('http://ip-api.com/json/?fields=lat,lon,city,country')
    .then(function (res) { return res.json(); })
    .then(function (data) {
      if (data.lat && data.lon) {
        map.setView([data.lat, data.lon], 13);

        // Create a position marker at the IP-derived location
        if (!livePositionMarker) {
          livePositionMarker = L.marker([data.lat, data.lon], {
            icon: L.divIcon({
              className: '',
              html: '<div class="live-position-icon"></div>',
              iconSize: [16, 16],
              iconAnchor: [8, 8]
            }),
            zIndexOffset: 2000
          }).addTo(map);
        } else {
          livePositionMarker.setLatLng([data.lat, data.lon]);
        }

        updateTelemetryDisplay({
          altitude: 0,
          speed: 0,
          batteryPercent: 100,
          lat: data.lat,
          lng: data.lon,
          headingDegrees: 0
        });

        telemBattery.textContent = 'N/A';
        telemBattery.style.color = '#8b949e';

        var locationName = (data.city || '') + (data.country ? ', ' + data.country : '');
        showAlert('📍 Approximate location: ' + locationName, 'info');
      }
    })
    .catch(function (err) {
      console.error('IP location fetch failed:', err);
      showAlert('⚠️ Could not determine location', 'warning');
    });
}


// ─────────────────────────────────────────────
// UI HELPERS
// ─────────────────────────────────────────────

/**
 * Enables/disables buttons based on the current state.
 */
function updateButtonStates() {
  var hasWaypoints = missionState.waypoints.length > 0;
  // Can simulate if there are at least 2 waypoints AND there are unvisited segments ahead
  var hasUnvisitedSegments = missionState.resumeFromIndex < missionState.waypoints.length - 1;
  var canSimulate = missionState.waypoints.length >= 2 && !missionState.isSimulating && hasUnvisitedSegments;

  // In live mode, disable sim controls
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

  // Reset pause button text
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
btnModalClose.addEventListener('click', function () {
  modalOverlay.classList.add('hidden');
});

// Mode toggle switch
modeSwitch.addEventListener('change', function () {
  switchMode(this.checked ? 'live' : 'simulator');
});

// Initialize button states on load
updateButtonStates();


// ─────────────────────────────────────────────
// MODULE G — DEVICE DETECTION & RESPONSIVE UI
// ─────────────────────────────────────────────

/** Reference to the device badge element */
var deviceBadge = document.getElementById('device-badge');

/** Reference to the dashboard section */
var dashboardSection = document.getElementById('dashboard-section');

/** Reference to the dashboard toggle arrow */
var dashArrow = document.getElementById('dash-arrow');

/** Whether the dashboard is currently collapsed (for tablet/mobile) */
var dashboardCollapsed = false;

/**
 * Detects the device type using a combination of:
 *  1. Screen width (primary signal)
 *  2. Touch capability
 *  3. User agent string (fallback/confirmation)
 *
 * Sets a CSS class on <body> and updates the device badge.
 *
 * @returns {string} 'mobile' | 'tablet' | 'desktop'
 */
function detectDeviceType() {
  var width = window.innerWidth;
  var hasTouch = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
  var ua = navigator.userAgent.toLowerCase();

  // Check user agent for mobile/tablet hints
  var uaMobile = /iphone|ipod|android.*mobile|windows phone|blackberry/i.test(ua);
  var uaTablet = /ipad|android(?!.*mobile)|tablet|kindle|silk/i.test(ua);

  var deviceType;

  if (width <= 480 || uaMobile) {
    deviceType = 'mobile';
  } else if ((width <= 960 && hasTouch) || uaTablet) {
    deviceType = 'tablet';
  } else {
    deviceType = 'desktop';
  }

  // Set CSS class on body for device-specific styling
  document.body.classList.remove('device-mobile', 'device-tablet', 'device-desktop');
  document.body.classList.add('device-' + deviceType);

  // Update the badge in the header
  var icons = { mobile: '📱', tablet: '📟', desktop: '🖥️' };
  deviceBadge.textContent = icons[deviceType] + ' ' + deviceType.toUpperCase();

  // On tablet/mobile, collapse dashboard by default
  if (deviceType !== 'desktop') {
    if (!dashboardCollapsed) {
      collapseDashboard();
    }
  } else {
    // On desktop, always show dashboard expanded
    expandDashboard();
  }

  return deviceType;
}

/**
 * Collapses the telemetry dashboard (hides it).
 * Only used on tablet/mobile layouts.
 */
function collapseDashboard() {
  dashboardCollapsed = true;
  dashboardSection.style.display = 'none';
  if (dashArrow) dashArrow.classList.add('collapsed');
}

/**
 * Expands the telemetry dashboard (shows it).
 */
function expandDashboard() {
  dashboardCollapsed = false;
  dashboardSection.style.display = '';
  if (dashArrow) dashArrow.classList.remove('collapsed');
}

/**
 * Toggles the dashboard visibility (for the collapse button).
 * This function is called from the onclick in the HTML.
 */
function toggleDashboard() {
  if (dashboardCollapsed) {
    expandDashboard();
  } else {
    collapseDashboard();
  }
}

// Run device detection on page load
detectDeviceType();

// Re-detect when the window is resized (e.g., rotating a tablet)
window.addEventListener('resize', function () {
  detectDeviceType();
  // Invalidate the Leaflet map size after layout change
  setTimeout(function () { map.invalidateSize(); }, 200);
});
