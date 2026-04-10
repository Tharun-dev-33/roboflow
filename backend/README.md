# RoboFlow ↔ ROS 2 backend (`roboflow_runner`)

Runs the **same JSON** the web UI exports (**Save**): `blocks` + `connections`.

## 1. Put the package in your workspace (Ubuntu)

```bash
cd ~/ros2_ws/src
# Copy this folder next to your other packages:
#   RoboFlow/backend/roboflow_runner  →  ~/ros2_ws/src/roboflow_runner

sudo apt update
sudo apt install ros-${ROS_DISTRO}-nav2-msgs ros-${ROS_DISTRO}-std-srvs 2>/dev/null || true

cd ~/ros2_ws
colcon build --packages-select roboflow_runner
source install/setup.bash
```

## 2. Start the backend (recommended: HTTP + browser)

This opens an HTTP API so you can **push flows from Windows** without copying files.

```bash
ros2 launch roboflow_runner roboflow_backend.launch.py
```

Defaults:

- **HTTP** `http://UBUNTU_IP:8765`
- `GET  /api/health` — check it is alive  
- `POST /api/flow` — body = raw JSON from RoboFlow **Save** (same as file contents)  
- `POST /api/run` — start execution on the robot  
- `POST /api/stop` — stop and send zero `cmd_vel`

ROS services (same node):

- `ros2 service call /roboflow_runner/run_flow std_srvs/srv/Trigger`
- `ros2 service call /roboflow_runner/stop_flow std_srvs/srv/Trigger`

## 3. Connect the web UI

1. Open **Settings** in RoboFlow.
2. Set **ROS 2 backend URL** to `http://YOUR_UBUNTU_IP:8765` (no trailing slash).
3. Use **Run on ROS 2** in the toolbar (sends flow + starts run).

Firewall (if needed):

```bash
sudo ufw allow 8765/tcp
```

## 4. Run from a JSON file only (no HTTP)

```bash
ros2 launch roboflow_runner roboflow_from_file.launch.py \
  flow_json:=/home/you/flow.json
```

## Parameters (overview)

| Parameter | Default | Meaning |
|-----------|---------|---------|
| `enable_http_api` | `true` in `roboflow_backend.launch.py` | Enable HTTP |
| `http_port` | `8765` | Listen port |
| `http_bind` | `0.0.0.0` | Listen address |
| `flow_json_path` | `""` | File path if not using POST /api/flow |
| `auto_start` | `false` in HTTP launch | Run file on node start |
| `cmd_vel_topic` | `/cmd_vel` | Twist topic |
| `max_linear` / `max_angular` | `0.5` / `1.0` | Motion caps |
| `navigate_action_name` | `navigate_to_pose` | Nav2 action |

String topics default to `/dock_command`, `/cargo_command`, `/robot_command`, etc. (see `runner_node.py`).

## Requirements on the robot

- **Nav2** (or compatible) if you use **Go to Waypoint** / **Return home** — action `navigate_to_pose`.
- **cmd_vel** subscriber for motion blocks.
- Your stack must subscribe to the String topics you use, or change parameters to match your drivers.
