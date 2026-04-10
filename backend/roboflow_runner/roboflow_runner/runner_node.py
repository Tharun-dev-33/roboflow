"""ROS 2 node: RoboFlow JSON → cmd_vel, String topics, Nav2 NavigateToPose."""

from __future__ import annotations

import copy
import json
import math
import threading
import time
from pathlib import Path
from typing import Any, Dict, Optional, Tuple

import rclpy
from geometry_msgs.msg import Twist
from nav2_msgs.action import NavigateToPose
from rclpy.action import ActionClient
from rclpy.node import Node
from std_msgs.msg import String
from std_srvs.srv import Trigger

from roboflow_runner.flow_executor import FlowExecutionError, run_flow
from roboflow_runner.http_api import start_http_api


def yaw_to_quaternion(yaw: float) -> tuple:
    half = yaw * 0.5
    return 0.0, 0.0, math.sin(half), math.cos(half)


class RoboFlowRunnerNode(Node):
    def __init__(self) -> None:
        super().__init__('roboflow_runner')

        self.declare_parameter('flow_json_path', '')
        self.declare_parameter('cmd_vel_topic', '/cmd_vel')
        self.declare_parameter('max_linear', 0.5)
        self.declare_parameter('max_angular', 1.0)
        self.declare_parameter('navigate_action_name', 'navigate_to_pose')
        self.declare_parameter('auto_start', False)

        self.declare_parameter('dock_command_topic', '/dock_command')
        self.declare_parameter('cargo_command_topic', '/cargo_command')
        self.declare_parameter('robot_command_topic', '/robot_command')
        self.declare_parameter('robot_events_topic', '/robot_events')
        self.declare_parameter('sensor_command_topic', '/sensor_command')
        self.declare_parameter('set_home_topic', '/set_home')

        self.declare_parameter('enable_http_api', True)
        self.declare_parameter('http_port', 8765)
        self.declare_parameter('http_bind', '0.0.0.0')

        self._max_linear = float(self.get_parameter('max_linear').value)
        self._max_angular = float(self.get_parameter('max_angular').value)
        self._cmd_topic = self.get_parameter('cmd_vel_topic').value
        self._nav_action = self.get_parameter('navigate_action_name').value

        self._pub_cmd_vel = self.create_publisher(Twist, self._cmd_topic, 10)
        self._string_publishers: Dict[str, Any] = {}

        self._nav_client = ActionClient(self, NavigateToPose, self._nav_action)

        self._stop_event = threading.Event()
        self._run_lock = threading.Lock()
        self._flow_lock = threading.Lock()
        self._flow_payload: Optional[dict] = None
        self._flow_thread: Optional[threading.Thread] = None
        self._http_server = None

        self.create_service(Trigger, '~/run_flow', self._cb_run_flow)
        self.create_service(Trigger, '~/stop_flow', self._cb_stop_flow)

        http_on = self.get_parameter('enable_http_api').value
        if isinstance(http_on, str):
            http_on = http_on.lower() in ('1', 'true', 'yes')
        if http_on:
            bind = self.get_parameter('http_bind').value
            port = int(self.get_parameter('http_port').value)
            self._http_server = start_http_api(self, str(bind), port)

        auto = self.get_parameter('auto_start').value
        if isinstance(auto, str):
            auto = auto.lower() in ('1', 'true', 'yes')
        if bool(auto):
            self._start_flow_thread()

        self.get_logger().info('roboflow_runner ready (ROS 2 + optional HTTP API).')

    # ── Flow source: HTTP payload overrides file ─────────────
    def set_flow_payload(self, flow: dict) -> None:
        with self._flow_lock:
            self._flow_payload = copy.deepcopy(flow)

    def request_run_from_api(self) -> Tuple[bool, str]:
        ok = self._start_flow_thread()
        return (ok, 'Started' if ok else 'Already running')

    def request_stop_from_api(self) -> None:
        self._stop_event.set()
        self._twist(0.0, 0.0, 0.0)

    def _pub_string(self, topic: str, data: str) -> None:
        if topic not in self._string_publishers:
            self._string_publishers[topic] = self.create_publisher(String, topic, 10)
        msg = String()
        msg.data = data
        self._string_publishers[topic].publish(msg)
        self.get_logger().info(f'String {topic}: {data}')

    def _twist(self, lx: float, ly: float, az: float) -> None:
        t = Twist()
        t.linear.x = float(lx)
        t.linear.y = float(ly)
        t.linear.z = 0.0
        t.angular.z = float(az)
        self._pub_cmd_vel.publish(t)

    def _sleep(self, seconds: float) -> None:
        end = time.monotonic() + max(0.0, seconds)
        while time.monotonic() < end:
            if self._stop_event.is_set():
                return
            time.sleep(min(0.05, end - time.monotonic()))

    def _send_nav_goal(self, x: float, y: float, yaw_rad: float, wait_done: bool) -> None:
        if not self._nav_client.wait_for_server(timeout_sec=5.0):
            self.get_logger().warn(
                f'NavigateToPose "{self._nav_action}" not available — skipping goal'
            )
            return

        goal = NavigateToPose.Goal()
        goal.pose.header.frame_id = 'map'
        goal.pose.header.stamp = self.get_clock().now().to_msg()
        goal.pose.pose.position.x = float(x)
        goal.pose.pose.position.y = float(y)
        goal.pose.pose.position.z = 0.0
        qx, qy, qz, qw = yaw_to_quaternion(yaw_rad)
        goal.pose.pose.orientation.x = qx
        goal.pose.pose.orientation.y = qy
        goal.pose.pose.orientation.z = qz
        goal.pose.pose.orientation.w = qw

        send_future = self._nav_client.send_goal_async(goal)
        while not send_future.done():
            if self._stop_event.is_set():
                return
            time.sleep(0.05)

        gh = send_future.result()
        if not gh or not gh.accepted:
            self.get_logger().error('NavigateToPose goal rejected')
            return

        self.get_logger().info('NavigateToPose goal accepted')

        if not wait_done:
            return

        result_future = gh.get_result_async()
        while not result_future.done():
            if self._stop_event.is_set():
                gh.cancel_goal_async()
                return
            time.sleep(0.05)

    def _dispatch_block(self, btype: str, params: dict) -> None:
        p = params or {}

        if btype == 'start':
            self.get_logger().info('▶ Flow started')
            return

        if btype == 'end':
            self._twist(0.0, 0.0, 0.0)
            self.get_logger().info('⏹ Flow complete')
            return

        if btype == 'move_forward':
            spd = min(float(p.get('speed', 0.3)), self._max_linear)
            dur = float(p.get('duration', 2.0))
            self.get_logger().info(f'↑ forward {spd} m/s × {dur} s')
            self._twist(spd, 0.0, 0.0)
            self._sleep(dur)
            self._twist(0.0, 0.0, 0.0)
            return

        if btype == 'move_backward':
            spd = min(float(p.get('speed', 0.3)), self._max_linear)
            dur = float(p.get('duration', 2.0))
            self.get_logger().info(f'↓ backward {spd} m/s × {dur} s')
            self._twist(-spd, 0.0, 0.0)
            self._sleep(dur)
            self._twist(0.0, 0.0, 0.0)
            return

        if btype == 'rotate_left':
            spd = min(float(p.get('angular_speed', 0.6)), self._max_angular)
            dur = float(p.get('duration', 2.0))
            self._twist(0.0, 0.0, spd)
            self._sleep(dur)
            self._twist(0.0, 0.0, 0.0)
            return

        if btype == 'rotate_right':
            spd = min(float(p.get('angular_speed', 0.6)), self._max_angular)
            dur = float(p.get('duration', 2.0))
            self._twist(0.0, 0.0, -spd)
            self._sleep(dur)
            self._twist(0.0, 0.0, 0.0)
            return

        if btype == 'set_speed':
            self._max_linear = float(p.get('linear', self._max_linear))
            self._max_angular = float(p.get('angular', self._max_angular))
            return

        if btype == 'stop':
            self._twist(0.0, 0.0, 0.0)
            hold = float(p.get('duration', 0.0))
            if hold > 0.0:
                self._sleep(hold)
            return

        if btype == 'navigate_to_pose':
            x = float(p.get('x', 0.0))
            y = float(p.get('y', 0.0))
            heading_deg = float(p.get('heading', 0.0))
            theta = math.radians(heading_deg)
            wait_done = bool(p.get('wait_done', True))
            self.get_logger().info(f'📍 Navigate → ({x}, {y}) θ={heading_deg}°')
            self._send_nav_goal(x, y, theta, wait_done)
            return

        if btype == 'return_home':
            self._send_nav_goal(0.0, 0.0, 0.0, True)
            return

        if btype == 'set_home':
            topic = self.get_parameter('set_home_topic').value
            self._pub_string(topic, f'{p.get("x", 0)},{p.get("y", 0)}')
            return

        if btype == 'dock':
            topic = self.get_parameter('dock_command_topic').value
            self._pub_string(topic, f'station:{p.get("station_id", 1)}')
            self._sleep(3.0)
            return

        if btype == 'undock':
            topic = self.get_parameter('dock_command_topic').value
            self._pub_string(topic, 'undock')
            self._sleep(2.0)
            return

        if btype == 'wait_station':
            self._sleep(float(p.get('wait_time', 5.0)))
            return

        if btype == 'pickup_cargo':
            topic = self.get_parameter('cargo_command_topic').value
            self._pub_string(topic, f'pickup:{p.get("cargo_id", 1)}')
            self._sleep(2.0)
            return

        if btype == 'drop_cargo':
            topic = self.get_parameter('cargo_command_topic').value
            self._pub_string(topic, f'drop:{p.get("cargo_id", 1)}')
            self._sleep(2.0)
            return

        if btype == 'charge':
            topic = self.get_parameter('robot_command_topic').value
            self._pub_string(topic, 'charge')
            self._sleep(3.0)
            return

        if btype == 'wait':
            self._sleep(float(p.get('duration', 2.0)))
            return

        if btype == 'emit_event':
            topic = self.get_parameter('robot_events_topic').value
            self._pub_string(topic, str(p.get('event_name', 'task_done')))
            return

        if btype == 'check_battery':
            topic = self.get_parameter('robot_command_topic').value
            self._pub_string(topic, 'check_battery')
            self._sleep(0.5)
            return

        if btype == 'detect_obstacle':
            topic = self.get_parameter('sensor_command_topic').value
            self._pub_string(topic, f'scan:{p.get("range", 1.0)}')
            self._sleep(0.5)
            return

        if btype == 'read_position':
            topic = self.get_parameter('robot_command_topic').value
            self._pub_string(topic, 'get_position')
            self._sleep(0.3)
            return

        self.get_logger().warn(f'Unknown block "{btype}" — skip')

    def _load_flow(self) -> dict:
        with self._flow_lock:
            if self._flow_payload is not None:
                return copy.deepcopy(self._flow_payload)

        path = self.get_parameter('flow_json_path').value
        if not path or not str(path).strip():
            raise FlowExecutionError(
                'No flow: POST JSON to /api/flow or set parameter flow_json_path'
            )
        fp = Path(str(path)).expanduser().resolve()
        if not fp.is_file():
            raise FlowExecutionError(f'flow_json_path not found: {fp}')
        with fp.open(encoding='utf-8') as f:
            return json.load(f)

    def _run_flow_body(self) -> None:
        self._stop_event.clear()
        try:
            flow = self._load_flow()
        except (OSError, json.JSONDecodeError, FlowExecutionError) as e:
            self.get_logger().error(str(e))
            return

        try:
            run_flow(
                flow,
                self._dispatch_block,
                should_stop=lambda: self._stop_event.is_set(),
                log=lambda m: self.get_logger().info(m),
            )
        except FlowExecutionError as e:
            self.get_logger().error(str(e))
        finally:
            self._twist(0.0, 0.0, 0.0)

    def _start_flow_thread(self) -> bool:
        with self._run_lock:
            if self._flow_thread and self._flow_thread.is_alive():
                self.get_logger().warn('Flow already running')
                return False
            self._flow_thread = threading.Thread(target=self._run_flow_body, daemon=True)
            self._flow_thread.start()
            return True

    def _cb_run_flow(self, _req: Trigger.Request, resp: Trigger.Response) -> Trigger.Response:
        ok = self._start_flow_thread()
        resp.success = ok
        resp.message = 'Started' if ok else 'Already running'
        return resp

    def _cb_stop_flow(self, _req: Trigger.Request, resp: Trigger.Response) -> Trigger.Response:
        self.request_stop_from_api()
        resp.success = True
        resp.message = 'Stopped'
        return resp


def main(args=None) -> None:
    rclpy.init(args=args)
    node = RoboFlowRunnerNode()
    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass
    finally:
        node.request_stop_from_api()
        node.destroy_node()
        rclpy.shutdown()


if __name__ == '__main__':
    main()
