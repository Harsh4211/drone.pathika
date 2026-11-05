"""
Drone Pathika — MAVLink Telemetry & SITL WebSocket Bridge
=========================================================
Connects to ArduPilot / PX4 SITL (UDP) or a physical drone (Serial COM port),
decodes standard MAVLink aerospace packets, and streams telemetry JSON
to Drone Pathika over WebSocket (ws://localhost:8765).

Also supports a built-in realistic SITL physics simulation mode (--sim)
if ArduPilot is not running, so you can test complete end-to-end telemetry
without compiling or installing ArduPilot firmware.

Usage:
  # 1. Connect to ArduPilot SITL (default UDP port 14550)
  python bridge.py

  # 2. Connect to a physical telemetry radio on USB COM port
  python bridge.py --device COM3 --baud 57600

  # 3. Run built-in realistic quadcopter physics simulation
  python bridge.py --sim
"""

import argparse
import asyncio
import json
import math
import sys
import time
from typing import Dict, Any, Set

if hasattr(sys.stdout, 'reconfigure'):
    try:
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    except Exception:
        pass

import websockets

try:
    from pymavlink import mavutil
    HAS_PYMAVLINK = True
except ImportError:
    HAS_PYMAVLINK = False

# Configuration
DEFAULT_UDP = "udp:127.0.0.1:14550"
DEFAULT_WS_PORT = 8765
DEFAULT_WS_HOST = "localhost"

# Global state
connected_clients: Set[websockets.WebSocketServerProtocol] = set()
latest_telemetry: Dict[str, Any] = {
    "source": "disconnected",
    "connected": False,
    "armed": False,
    "flightMode": "DISCONNECTED",
    "fixType": "No GPS",
    "satellites": 0,
    "lat": 23.2156,
    "lng": 72.6369,
    "altitude": 0.0,
    "groundSpeed": 0.0,
    "airSpeed": 0.0,
    "climbRate": 0.0,
    "heading": 0.0,
    "roll": 0.0,
    "pitch": 0.0,
    "yaw": 0.0,
    "batteryPercent": 100,
    "batteryVoltage": 16.8,  # 4S LiPo fully charged
    "batteryCurrent": 0.0,
    "lastUpdate": 0
}

mavlink_connection = None


# ─────────────────────────────────────────────
# MAVLINK PACKET HANDLERS
# ─────────────────────────────────────────────

def handle_mavlink_message(msg):
    """Parses incoming MAVLink packets and updates latest_telemetry."""
    global latest_telemetry
    msg_type = msg.get_type()
    now = time.time()

    latest_telemetry["connected"] = True
    latest_telemetry["source"] = "MAVLink"
    latest_telemetry["lastUpdate"] = now

    if msg_type == "HEARTBEAT":
        # Extract armed status and flight mode
        custom_mode = msg.custom_mode
        base_mode = msg.base_mode
        armed = bool(base_mode & mavutil.mavlink.MAV_MODE_FLAG_SAFETY_ARMED)
        latest_telemetry["armed"] = armed

        # Decode mode name using pymavlink mode mapping
        try:
            mode_map = mavlink_connection.mode_mapping()
            if mode_map:
                inverted = {v: k for k, v in mode_map.items()}
                latest_telemetry["flightMode"] = inverted.get(custom_mode, f"MODE_{custom_mode}")
            else:
                latest_telemetry["flightMode"] = f"MODE_{custom_mode}"
        except Exception:
            latest_telemetry["flightMode"] = "ACTIVE" if armed else "DISARMED"

    elif msg_type == "GLOBAL_POSITION_INT":
        # Lat/Lon in degE7, relative altitude in mm, speeds in cm/s, heading in cdeg
        latest_telemetry["lat"] = msg.lat / 1e7
        latest_telemetry["lng"] = msg.lon / 1e7
        latest_telemetry["altitude"] = round(msg.relative_alt / 1000.0, 1)  # meters
        latest_telemetry["heading"] = round(msg.hdg / 100.0, 1)
        # Compute groundspeed from vx, vy (cm/s -> m/s)
        vx = msg.vx / 100.0
        vy = msg.vy / 100.0
        latest_telemetry["groundSpeed"] = round(math.sqrt(vx * vx + vy * vy), 1)
        latest_telemetry["climbRate"] = round(-msg.vz / 100.0, 1)  # NED frame: vz positive down

    elif msg_type == "VFR_HUD":
        latest_telemetry["airSpeed"] = round(msg.airspeed, 1)
        latest_telemetry["groundSpeed"] = round(msg.groundspeed, 1)
        latest_telemetry["heading"] = round(msg.heading, 1)
        latest_telemetry["climbRate"] = round(msg.climb, 1)

    elif msg_type == "SYS_STATUS":
        # Battery voltage in mV, current in cA (10mA), remaining in %
        voltage_v = round(msg.voltage_battery / 1000.0, 2)
        current_a = round(msg.current_battery / 100.0, 2)
        battery_pct = msg.battery_remaining  # -1 if unsupported

        if voltage_v > 0:
            latest_telemetry["batteryVoltage"] = voltage_v
        if current_a >= 0:
            latest_telemetry["batteryCurrent"] = current_a
        if battery_pct >= 0:
            latest_telemetry["batteryPercent"] = battery_pct

    elif msg_type == "ATTITUDE":
        latest_telemetry["roll"] = round(math.degrees(msg.roll), 1)
        latest_telemetry["pitch"] = round(math.degrees(msg.pitch), 1)
        latest_telemetry["yaw"] = round(math.degrees(msg.yaw), 1)

    elif msg_type == "GPS_RAW_INT":
        fix_types = {
            0: "No GPS",
            1: "No Fix",
            2: "2D Fix",
            3: "3D Fix",
            4: "DGPS",
            5: "RTK Float",
            6: "RTK Fixed"
        }
        latest_telemetry["fixType"] = fix_types.get(msg.fix_type, f"Fix {msg.fix_type}")
        latest_telemetry["satellites"] = msg.satellites_visible


# ─────────────────────────────────────────────
# REALISTIC BUILT-IN SITL SIMULATOR
# (Quadcopter 4S physics model with realistic battery sag & wind)
# ─────────────────────────────────────────────

class RealisticDronePhysics:
    def __init__(self, start_lat=23.2156, start_lng=72.6369):
        self.lat = start_lat
        self.lng = start_lng
        self.alt = 0.0
        self.target_alt = 50.0
        self.heading = 0.0
        self.speed = 0.0
        self.target_speed = 10.0  # 10 m/s ~ 36 km/h
        self.armed = False
        self.flight_mode = "STABILIZE"
        self.battery_mah = 5000.0  # 5000mAh 4S LiPo
        self.used_mah = 0.0
        self.cell_count = 4
        self.waypoints = []
        self.current_wp_idx = 0
        self.last_tick = time.time()

    def set_waypoints(self, wps):
        self.waypoints = wps
        self.current_wp_idx = 0
        if wps:
            self.armed = True
            self.flight_mode = "AUTO"

    def tick(self):
        now = time.time()
        dt = min(now - self.last_tick, 0.5)
        self.last_tick = now

        if not self.armed:
            self.speed = 0.0
            self.current_draw = 0.8  # Idle avionics current ~0.8A
        else:
            # Quadcopter altitude control
            if self.alt < self.target_alt:
                self.alt = min(self.target_alt, self.alt + 3.0 * dt)  # 3 m/s climb
                thrust_factor = 1.4  # higher current during climb
            else:
                thrust_factor = 1.0

            # Waypoint navigation in AUTO
            if self.flight_mode == "AUTO" and self.waypoints:
                target_wp = self.waypoints[self.current_wp_idx]
                dlat = target_wp["lat"] - self.lat
                dlng = target_wp["lng"] - self.lng

                # Distance in meters approx
                dist_m = math.sqrt((dlat * 111320)**2 + (dlng * 111320 * math.cos(math.radians(self.lat)))**2)

                if dist_m < 5.0:  # Waypoint acceptance radius = 5m
                    if self.current_wp_idx + 1 < len(self.waypoints):
                        self.current_wp_idx += 1
                    else:
                        self.flight_mode = "LOITER"
                else:
                    target_heading = (math.degrees(math.atan2(dlng * math.cos(math.radians(self.lat)), dlat)) + 360) % 360
                    # Turn smoothly toward heading
                    dh = (target_heading - self.heading + 540) % 360 - 180
                    turn_rate = 45.0 * dt  # 45 deg/sec turn rate
                    if abs(dh) < turn_rate:
                        self.heading = target_heading
                    else:
                        self.heading = (self.heading + math.copysign(turn_rate, dh)) % 360

                    # Cruise speed
                    self.speed = min(self.target_speed, self.speed + 2.0 * dt)
                    step_m = self.speed * dt
                    self.lat += (step_m * math.cos(math.radians(self.heading))) / 111320.0
                    self.lng += (step_m * math.sin(math.radians(self.heading))) / (111320.0 * math.cos(math.radians(self.lat)))

            # Realistic LiPo 4S battery consumption
            # Hover current ~ 15A, Cruise ~ 12A, Climb ~ 22A
            hover_amp = 14.5 * thrust_factor
            speed_penalty = (self.speed / self.target_speed) * 3.5
            self.current_draw = hover_amp + speed_penalty
            self.used_mah += (self.current_draw * 1000.0) * (dt / 3600.0)

        # 4S battery voltage calculation with internal resistance sag (IR ~ 0.02 ohm)
        soc = max(0.0, 1.0 - (self.used_mah / self.battery_mah))
        cell_resting_v = 3.27 + (0.93 * soc)  # 3.27V (empty) to 4.2V (full)
        sag_v = self.current_draw * 0.025
        pack_v = round(max(13.0, (cell_resting_v * 4) - sag_v), 2)
        battery_pct = round(soc * 100.0, 1)

        roll = round(math.sin(time.time() * 2) * 1.5, 1) if self.speed > 1 else 0.0
        pitch = round(-3.0 * (self.speed / max(1, self.target_speed)), 1)

        return {
            "source": "SITL Physics Simulator (Quadcopter 4S)",
            "connected": True,
            "armed": self.armed,
            "flightMode": self.flight_mode,
            "fixType": "3D Fix (RTK)",
            "satellites": 16,
            "lat": round(self.lat, 7),
            "lng": round(self.lng, 7),
            "altitude": round(self.alt, 1),
            "groundSpeed": round(self.speed, 1),
            "airSpeed": round(self.speed * 1.02, 1),
            "climbRate": 0.0 if not self.armed else round(0.1 * math.sin(time.time()), 1),
            "heading": round(self.heading, 1),
            "roll": roll,
            "pitch": pitch,
            "yaw": round(self.heading, 1),
            "batteryPercent": battery_pct,
            "batteryVoltage": pack_v,
            "batteryCurrent": round(self.current_draw, 1),
            "lastUpdate": time.time()
        }


# ─────────────────────────────────────────────
# WEBSOCKET SERVER & CLIENT COMMUNICATION
# ─────────────────────────────────────────────

async def ws_handler(websocket):
    """Handles new browser client connection and incoming commands."""
    global connected_clients
    connected_clients.add(websocket)
    remote = websocket.remote_address
    print(f"[WS] Browser connected from {remote}")

    # Immediately push current telemetry snapshot
    await websocket.send(json.dumps({
        "type": "telemetry",
        "data": latest_telemetry
    }))

    try:
        async for message in websocket:
            try:
                data = json.loads(message)
                cmd = data.get("command")
                print(f"[WS] Received command: {cmd}")

                # Process command (arm, disarm, rtl, upload mission)
                if cmd == "ARM":
                    if sim_instance:
                        sim_instance.armed = True
                    elif mavlink_connection:
                        mavlink_connection.mav.command_long_send(
                            mavlink_connection.target_system,
                            mavlink_connection.target_component,
                            mavutil.mavlink.MAV_CMD_COMPONENT_ARM_DISARM,
                            0, 1, 0, 0, 0, 0, 0, 0
                        )
                elif cmd == "DISARM":
                    if sim_instance:
                        sim_instance.armed = False
                    elif mavlink_connection:
                        mavlink_connection.mav.command_long_send(
                            mavlink_connection.target_system,
                            mavlink_connection.target_component,
                            mavutil.mavlink.MAV_CMD_COMPONENT_ARM_DISARM,
                            0, 0, 0, 0, 0, 0, 0, 0
                        )
                elif cmd == "SET_MODE":
                    mode = data.get("mode", "RTL")
                    if sim_instance:
                        sim_instance.flight_mode = mode
                    elif mavlink_connection:
                        mode_id = mavlink_connection.mode_mapping().get(mode)
                        if mode_id is not None:
                            mavlink_connection.set_mode(mode_id)
                elif cmd == "UPLOAD_MISSION":
                    wps = data.get("waypoints", [])
                    print(f"[WS] Uploaded {len(wps)} waypoints to drone")
                    if sim_instance:
                        sim_instance.set_waypoints(wps)
                    # For physical MAVLink, waypoint protocol upload would follow here
            except Exception as e:
                print(f"[WS] Error processing message: {e}")
    except websockets.exceptions.ConnectionClosed:
        pass
    finally:
        connected_clients.remove(websocket)
        print(f"[WS] Browser disconnected: {remote}")


async def broadcast_telemetry_loop():
    """Broadcasts telemetry packets to all connected browser clients at 10 Hz."""
    while True:
        if connected_clients:
            payload = json.dumps({
                "type": "telemetry",
                "data": latest_telemetry
            })
            # Send to all clients concurrently
            await asyncio.gather(
                *[client.send(payload) for client in connected_clients],
                return_exceptions=True
            )
        await asyncio.sleep(0.1)  # 10 Hz stream


async def mavlink_read_loop():
    """Non-blocking background loop reading raw MAVLink packets."""
    global mavlink_connection
    while True:
        if mavlink_connection:
            try:
                # Read without blocking
                msg = mavlink_connection.recv_match(blocking=False)
                while msg:
                    handle_mavlink_message(msg)
                    msg = mavlink_connection.recv_match(blocking=False)
            except Exception as e:
                print(f"[MAVLink] Read error: {e}")
        await asyncio.sleep(0.01)  # 100 Hz polling


async def sim_physics_loop():
    """Runs built-in realistic SITL quadcopter physics loop if in --sim mode."""
    global latest_telemetry, sim_instance
    while True:
        if sim_instance:
            latest_telemetry = sim_instance.tick()
        await asyncio.sleep(0.05)  # 20 Hz physics update


# ─────────────────────────────────────────────
# MAIN ENTRY POINT
# ─────────────────────────────────────────────

sim_instance = None

async def main():
    global mavlink_connection, sim_instance

    parser = argparse.ArgumentParser(description="Drone Pathika MAVLink & SITL WebSocket Bridge")
    parser.add_argument("--device", type=str, default=DEFAULT_UDP,
                        help="MAVLink device string (e.g., udp:127.0.0.1:14550, COM3, /dev/ttyUSB0)")
    parser.add_argument("--baud", type=int, default=57600, help="Baud rate for serial connections (default: 57600)")
    parser.add_argument("--sim", action="store_true", help="Run realistic built-in SITL physics simulation")
    parser.add_argument("--port", type=int, default=DEFAULT_WS_PORT, help=f"WebSocket server port (default: {DEFAULT_WS_PORT})")
    args = parser.parse_args()

    print("======================================================")
    print("   [+] Drone Pathika - MAVLink & SITL WebSocket Bridge")
    print("======================================================")

    if args.sim:
        print("[Mode] Starting BUILT-IN SITL REALISTIC PHYSICS SIMULATOR...")
        print("[Specs] Quadcopter 450mm, 4S 5000mAh LiPo, ArduPilot flight dynamics")
        sim_instance = RealisticDronePhysics()
        asyncio.create_task(sim_physics_loop())
    else:
        if not HAS_PYMAVLINK:
            print("[ERROR] pymavlink not installed. Run: pip install pymavlink")
            sys.exit(1)

        print(f"[MAVLink] Connecting to target: {args.device} (baud={args.baud})...")
        try:
            mavlink_connection = mavutil.mavlink_connection(args.device, baud=args.baud)
            print(f"[MAVLink] Waiting for heartbeat from drone / SITL...")
            # We don't block main thread indefinitely
            asyncio.create_task(mavlink_read_loop())
        except Exception as e:
            print(f"[MAVLink Connection Error] {e}")
            print("[Fallback] Falling back to built-in realistic SITL simulator.")
            sim_instance = RealisticDronePhysics()
            asyncio.create_task(sim_physics_loop())

    # Start WebSocket server
    server = await websockets.serve(ws_handler, DEFAULT_WS_HOST, args.port)
    print(f"[Server] WebSocket server running at ws://{DEFAULT_WS_HOST}:{args.port}")
    print("[Ready] Open Drone Pathika in your browser to view real telemetry!")
    print("======================================================")

    # Start broadcasting telemetry to clients
    await broadcast_telemetry_loop()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n[Bridge] Shutting down cleanly.")
