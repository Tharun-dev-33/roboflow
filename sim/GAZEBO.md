# Gazebo + browser 3D view

**Gazebo does not run inside the web page.** It runs on Ubuntu as a normal desktop / GPU app. The website can do two things:

1. **Built-in Three.js robot** — moves from the same `cmd_vel` and navigation blocks as your flow (simulation mode or when you drive the Remote).
2. **Mirror real pose** — after you connect **rosbridge** in Settings, enable **Mirror `/odom`** on the **3D Sim** tab so the fake robot follows Gazebo (or a real robot) odometry.

## Example: ROS 2 Humble + Gazebo (gz sim)

Commands vary slightly by distro; adjust package names if you use Jazzy, etc.

```bash
# Example meta-package (names differ per ROS release — search: ros2 gazebo sim humble)
sudo apt update
sudo apt install ros-humble-ros-gz-sim ros-humble-ros-gz-bridge ros-humble-rosbridge-server ros-humble-rosbridge-suite
```

Launch a simulation world and a robot that exposes `cmd_vel` and `odom` (use your vendor’s bringup if you have TurtleBot3, Clearpath, etc.). Generic pattern:

```bash
# Terminal A — simulation (example only; replace with your robot’s launch)
ros2 launch ros_gz_sim gz_sim.launch.py

# Terminal B — bridge ROS ↔ Gazebo topics if required (topic names depend on your launch)
# Often you bridge /cmd_vel and subscribe to odometry from the sim.
```

Then start **rosbridge** for the browser:

```bash
ros2 launch rosbridge_server rosbridge_websocket_launch.xml
```

In RoboFlow **Settings**:

1. Turn off **Simulation Mode** and **Connect** to `ws://UBUNTU_IP:9090`.
2. Open **3D Sim**, check **Mirror `/odom`**.

Your stack must publish **`nav_msgs/Odometry`** on `/odom` (or change the topic in `js/app.js` → `attachRosOdom(ros, '/your_odom')`).

## Topic checklist

| Purpose        | Typical topic   | Notes                          |
|----------------|-----------------|--------------------------------|
| Drive from UI  | `/cmd_vel`      | `geometry_msgs/Twist`          |
| Pose mirror    | `/odom`         | `nav_msgs/Odometry`            |
| Nav2 goal      | (action)        | Browser still uses roslib stub |

If your Gazebo robot uses different names, remap in a launch file or adjust RoboFlow settings / code.
