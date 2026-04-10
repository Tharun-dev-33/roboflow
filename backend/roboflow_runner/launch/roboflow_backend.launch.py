"""HTTP API on port 8765 — browser sends flow JSON; no JSON file required."""

from launch import LaunchDescription
from launch_ros.actions import Node


def generate_launch_description():
    return LaunchDescription([
        Node(
            package='roboflow_runner',
            executable='roboflow-runner',
            name='roboflow_runner',
            output='screen',
            parameters=[{
                'enable_http_api': True,
                'http_port': 8765,
                'http_bind': '0.0.0.0',
                'auto_start': False,
                'flow_json_path': '',
                'cmd_vel_topic': '/cmd_vel',
            }],
        ),
    ])
