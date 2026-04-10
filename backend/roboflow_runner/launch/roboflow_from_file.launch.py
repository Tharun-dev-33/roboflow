"""Run a saved JSON file on startup (no HTTP)."""

from launch import LaunchDescription
from launch.actions import DeclareLaunchArgument
from launch.substitutions import LaunchConfiguration
from launch_ros.actions import Node


def generate_launch_description():
    return LaunchDescription([
        DeclareLaunchArgument(
            'flow_json',
            description='Absolute path to flow JSON',
        ),
        DeclareLaunchArgument(
            'auto_start',
            default_value='true',
            description='Start flow when node starts',
        ),
        Node(
            package='roboflow_runner',
            executable='roboflow-runner',
            name='roboflow_runner',
            output='screen',
            parameters=[{
                'enable_http_api': False,
                'flow_json_path': LaunchConfiguration('flow_json'),
                'auto_start': LaunchConfiguration('auto_start'),
            }],
        ),
    ])
