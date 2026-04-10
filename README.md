RoboFlow — AMR/AGV HMI + Flow Programming + 3D Simulation + Voice Control
RoboFlow is a browser-based platform to control and program an AMR/AGV using:

Drag-and-drop flow blocks (low-code robot workflows)
Remote control (keyboard + virtual joysticks)
3D simulation (Three.js robot + cargo + dock + path drawing)
Voice commands (Web Speech API)
It supports motion, navigation, cargo pickup/drop, path-following, and loop-based automation.

Features
Flow Canvas
Blocks for motion, navigation, control, sensing, and AGV actions
Sequential execution with START → … → END
Loop Start / Loop End with body/exit branching
3D Simulation
Robot movement + rotation
Cargo pickup (nearest cargo if no ID)
Drop cargo anywhere (drops on ground near robot)
Draw a path on the floor and follow the path
Remote Control
Two joysticks (move + rotate)
Keyboard driving (WASD / arrows)
Voice Control
“move forward/backward”, “rotate left/right”, “pick up cargo”, “drop cargo”
Can also trigger block actions and flow run/pause/stop
Tech Stack
Frontend: HTML, CSS, Vanilla JavaScript
3D: Three.js
Joystick: nipplejs
ROS bridge: roslibjs + rosbridge (optional)
Voice: Web Speech API (SpeechRecognition, speechSynthesis)
Optional backend: Python HTTP API (roboflow_runner) for ROS2 integration / cloud parsing endpoints
Project Structure
index.html — main UI
css/ — UI + flow + sim styles
js/
flow-blocks.js — block definitions and execution behavior
flow-engine.js — canvas editor, blocks, connections
flow-executor.js — executes the flow graph, supports loops
sim-robot-3d.js — Three.js simulator, cargo, path follow
remote.js — joystick + keyboard remote control
voice-control.js — voice recognition, command routing, optional TTS
ros-bridge.js — ROS topic publishing wrapper (sim fallback)
app.js — UI wiring + settings
backend/roboflow_runner/ — optional ROS2 backend package (Ubuntu)
Getting Started (Simulation Only — no ROS needed)
Open the UI

Easiest: open index.html in Chrome / Edge
If browser blocks features when opened as a file, run a local server.
Recommended: run a local static server

Python:
cd d:\RoboFlow
python -m http.server 8000
Then open:

http://localhost:8000
Click Simulation Mode (default)
Use Remote Control panel or Voice button.
How to Use
Flow Canvas
Drag blocks from the palette.
Connect ports (output → input).
Configure block parameters in the right panel.
Press Run.
Loop Wiring (Loop Start / Loop End)
START → Loop Start (enter)
Loop Start (body) → block(s) inside loop → Loop End
Loop End → Loop Start (repeat)
Loop Start (exit) → next block after loop → END
Set Iterations on Loop Start.
Path Drawing
Click Draw Path and drag on the floor.
Click Follow Path.
Cargo
Say “pick up cargo”: robot goes to nearby cargo and picks it up (simulation logic).
Say “drop cargo”: cargo drops on the ground near the robot.
Voice Commands (examples)
Movement: “move forward”, “move backward”
Rotation: “rotate left”, “rotate right”
Cargo: “pick up cargo”, “drop cargo”
Flow: “run flow”, “pause flow”, “stop flow”
Path tools: “draw path”, “follow path”, “clear path”
Note: Voice control depends on browser support for Web Speech API. Chrome/Edge works best.

Optional: ROS 2 Backend (Ubuntu)
If you want to run flows against a real ROS2 system (or use the HTTP API backend), see:

backend/README.md
Typical launch:

ros2 launch roboflow_runner roboflow_backend.launch.py
Default:

http://<UBUNTU_IP>:8765
GET /api/health
POST /api/flow
POST /api/run
POST /api/stop
Troubleshooting
Voice not working
Use Chrome/Edge
Allow microphone permission
Use http://localhost server instead of file://
No movement
Ensure Simulation Mode is enabled
Check remote panel is visible and not e-stopped
Loop not repeating
Verify Loop End connects to Loop Start repeat input
Ensure Loop Start exit is connected to the next block
