import os
from glob import glob

from setuptools import find_packages, setup

package_name = 'roboflow_runner'

setup(
    name=package_name,
    version='0.2.0',
    packages=find_packages(exclude=['test']),
    data_files=[
        ('share/ament_index/resource_index/packages', ['resource/' + package_name]),
        ('share/' + package_name, ['package.xml']),
        ('share/' + package_name + '/examples', ['examples/sample_flow.json']),
        (os.path.join('share', package_name, 'launch'), glob('launch/*.py')),
    ],
    install_requires=['setuptools'],
    zip_safe=True,
    maintainer='RoboFlow',
    description='Execute RoboFlow JSON on ROS 2 with optional HTTP API',
    license='Apache-2.0',
    entry_points={
        'console_scripts': [
            'roboflow-runner = roboflow_runner.runner_node:main',
        ],
    },
)
