/**
 * RoboFlow — Block Definitions for AMR/AGV
 * Each block defines its visual appearance, parameters, and ROS 2 execute action.
 */
const FlowBlocks = (() => {

  /* ── Block Width & Port geometry ────────────────────────── */
  const BLOCK_W   = 210;
  const PORT_R    = 7;
  const HDR_H     = 38;
  const BODY_H    = 42; // per param row

  /* ── Categories ─────────────────────────────────────────── */
  const CATEGORIES = [
    { id: 'special',    label: '⬡ Flow',          color: '#14532d' },
    { id: 'motion',     label: '🏎 Motion',        color: '#1e3a8a' },
    { id: 'navigation', label: '🗺 Navigation',    color: '#4c1d95' },
    { id: 'agv',        label: '🏭 AGV / AMR',     color: '#064e3b' },
    { id: 'control',    label: '🔄 Control',       color: '#78350f' },
    { id: 'sensing',    label: '📡 Sensing',       color: '#7f1d1d' },
  ];

  /* ── Block Definitions ───────────────────────────────────── */
  const BLOCK_DEFS = [
    // ─────────── SPECIAL ───────────
    {
      id:       'start',
      label:    'START',
      category: 'special',
      color:    '#16a34a',
      icon:     '▶',
      inputs:   0,
      outputs:  1,
      params:   [],
      fixed:    true,  // cannot be deleted
      execute: async () => { ROS.simLog('▶ Flow started'); },
    },
    {
      id:       'end',
      label:    'END',
      category: 'special',
      color:    '#dc2626',
      icon:     '⏹',
      inputs:   1,
      outputs:  0,
      params:   [],
      fixed:    true,
      execute: async () => { ROS.simLog('⏹ Flow complete'); },
    },

    // ─────────── MOTION ───────────
    {
      id:       'move_forward',
      label:    'Move Forward',
      category: 'motion',
      color:    '#1d4ed8',
      icon:     '↑',
      inputs:   1,
      outputs:  1,
      params: [
        { name: 'speed',    label: 'Speed',    type: 'slider', min: 0.05, max: 2.0,  step: 0.05, default: 0.3,  unit: 'm/s' },
        { name: 'duration', label: 'Duration', type: 'slider', min: 0.5,  max: 30.0, step: 0.5,  default: 2.0,  unit: 's'   },
      ],
      execute: async (params) => {
        const cfg = ROS.getConfig();
        const spd = Math.min(params.speed, cfg.maxLinear);
        ROS.simLog(`↑ Move Forward  ${spd} m/s  ×  ${params.duration}s`);
        ROS.publishCmdVel(spd, 0, 0);
        await sleep(params.duration * 1000);
        ROS.publishCmdVel(0, 0, 0);
      },
    },
    {
      id:       'move_backward',
      label:    'Move Backward',
      category: 'motion',
      color:    '#1d4ed8',
      icon:     '↓',
      inputs:   1,
      outputs:  1,
      params: [
        { name: 'speed',    label: 'Speed',    type: 'slider', min: 0.05, max: 2.0,  step: 0.05, default: 0.3, unit: 'm/s' },
        { name: 'duration', label: 'Duration', type: 'slider', min: 0.5,  max: 30.0, step: 0.5,  default: 2.0, unit: 's'   },
      ],
      execute: async (params) => {
        const cfg = ROS.getConfig();
        const spd = Math.min(params.speed, cfg.maxLinear);
        ROS.simLog(`↓ Move Backward  ${spd} m/s  ×  ${params.duration}s`);
        ROS.publishCmdVel(-spd, 0, 0);
        await sleep(params.duration * 1000);
        ROS.publishCmdVel(0, 0, 0);
      },
    },
    {
      id:       'rotate_left',
      label:    'Rotate Left',
      category: 'motion',
      color:    '#2563eb',
      icon:     '↺',
      inputs:   1,
      outputs:  1,
      params: [
        { name: 'angular_speed', label: 'Ang. Speed', type: 'slider', min: 0.1, max: 3.14, step: 0.1, default: 0.6, unit: 'rad/s' },
        { name: 'duration',      label: 'Duration',   type: 'slider', min: 0.2, max: 20.0, step: 0.2, default: 2.0, unit: 's'     },
      ],
      execute: async (params) => {
        const cfg = ROS.getConfig();
        const spd = Math.min(params.angular_speed, cfg.maxAngular);
        ROS.simLog(`↺ Rotate Left  ${spd} rad/s  ×  ${params.duration}s`);
        ROS.publishCmdVel(0, 0, -spd);
        await sleep(params.duration * 1000);
        ROS.publishCmdVel(0, 0, 0);
      },
    },
    {
      id:       'rotate_right',
      label:    'Rotate Right',
      category: 'motion',
      color:    '#2563eb',
      icon:     '↻',
      inputs:   1,
      outputs:  1,
      params: [
        { name: 'angular_speed', label: 'Ang. Speed', type: 'slider', min: 0.1, max: 3.14, step: 0.1, default: 0.6, unit: 'rad/s' },
        { name: 'duration',      label: 'Duration',   type: 'slider', min: 0.2, max: 20.0, step: 0.2, default: 2.0, unit: 's'     },
      ],
      execute: async (params) => {
        const cfg = ROS.getConfig();
        const spd = Math.min(params.angular_speed, cfg.maxAngular);
        ROS.simLog(`↻ Rotate Right  ${spd} rad/s  ×  ${params.duration}s`);
        ROS.publishCmdVel(0, 0, spd);
        await sleep(params.duration * 1000);
        ROS.publishCmdVel(0, 0, 0);
      },
    },
    {
      id:       'set_speed',
      label:    'Set Speed',
      category: 'motion',
      color:    '#3b82f6',
      icon:     '⚡',
      inputs:   1,
      outputs:  1,
      params: [
        { name: 'linear',  label: 'Linear',  type: 'slider', min: 0, max: 2.0,  step: 0.05, default: 0.5, unit: 'm/s'   },
        { name: 'angular', label: 'Angular', type: 'slider', min: 0, max: 3.14, step: 0.1,  default: 1.0, unit: 'rad/s' },
      ],
      execute: async (params) => {
        ROS.simLog(`⚡ Set Speed — linear: ${params.linear}, angular: ${params.angular}`);
        ROS.updateConfig({ maxLinear: params.linear, maxAngular: params.angular });
      },
    },
    {
      id:       'stop',
      label:    'Stop',
      category: 'motion',
      color:    '#ef4444',
      icon:     '⏹',
      inputs:   1,
      outputs:  1,
      params: [
        { name: 'duration', label: 'Hold (s)', type: 'slider', min: 0, max: 10, step: 0.5, default: 0, unit: 's' },
      ],
      execute: async (params) => {
        ROS.simLog('⏹ Stop');
        ROS.publishCmdVel(0, 0, 0);
        if (params.duration > 0) await sleep(params.duration * 1000);
      },
    },

    // ─────────── NAVIGATION ───────────
    {
      id:       'navigate_to_pose',
      label:    'Go to Waypoint',
      category: 'navigation',
      color:    '#7c3aed',
      icon:     '📍',
      inputs:   1,
      outputs:  1,
      params: [
        { name: 'x',         label: 'X (m)',  type: 'number', default: 1.0,  unit: 'm'   },
        { name: 'y',         label: 'Y (m)',  type: 'number', default: 0.0,  unit: 'm'   },
        { name: 'heading',   label: 'Heading',type: 'slider', min: -180, max: 180, step: 5, default: 0, unit: '°' },
        { name: 'wait_done', label: 'Wait for arrival', type: 'toggle', default: true },
      ],
      execute: async (params) => {
        const theta = (params.heading * Math.PI) / 180;
        ROS.simLog(`📍 Navigate → (${params.x}, ${params.y}) θ=${params.heading}°`);
        ROS.navigateToPose(params.x, params.y, theta);
        if (params.wait_done) await sleep(3000); // sim: wait 3s
      },
    },
    {
      id:       'return_home',
      label:    'Return to Home',
      category: 'navigation',
      color:    '#6d28d9',
      icon:     '🏠',
      inputs:   1,
      outputs:  1,
      params: [],
      execute: async () => {
        ROS.simLog('🏠 Return to Home position');
        ROS.navigateToPose(0, 0, 0);
        await sleep(2000);
      },
    },
    {
      id:       'set_home',
      label:    'Set Home Position',
      category: 'navigation',
      color:    '#5b21b6',
      icon:     '📌',
      inputs:   1,
      outputs:  1,
      params: [
        { name: 'x', label: 'X (m)', type: 'number', default: 0.0, unit: 'm' },
        { name: 'y', label: 'Y (m)', type: 'number', default: 0.0, unit: 'm' },
      ],
      execute: async (params) => {
        ROS.simLog(`📌 Set Home → (${params.x}, ${params.y})`);
        ROS.publishString('/set_home', `${params.x},${params.y}`);
      },
    },

    // ─────────── AGV / AMR ───────────
    {
      id:       'dock',
      label:    'Dock at Station',
      category: 'agv',
      color:    '#065f46',
      icon:     '⚓',
      inputs:   1,
      outputs:  1,
      params: [
        { name: 'station_id', label: 'Station ID', type: 'number', default: 1, unit: '' },
      ],
      execute: async (params) => {
        ROS.simLog(`⚓ Dock at Station ${params.station_id}`);
        ROS.publishString('/dock_command', `station:${params.station_id}`);
        await sleep(3000);
      },
    },
    {
      id:       'undock',
      label:    'Undock',
      category: 'agv',
      color:    '#065f46',
      icon:     '🚀',
      inputs:   1,
      outputs:  1,
      params: [],
      execute: async () => {
        ROS.simLog('🚀 Undocking');
        ROS.publishString('/dock_command', 'undock');
        await sleep(2000);
      },
    },
    {
      id:       'wait_station',
      label:    'Wait at Station',
      category: 'agv',
      color:    '#047857',
      icon:     '⏳',
      inputs:   1,
      outputs:  1,
      params: [
        { name: 'wait_time', label: 'Wait Time', type: 'slider', min: 1, max: 120, step: 1, default: 5, unit: 's' },
      ],
      execute: async (params) => {
        ROS.simLog(`⏳ Waiting at station ${params.wait_time}s…`);
        await sleep(params.wait_time * 1000);
      },
    },
    {
      id:       'pickup_cargo',
      label:    'Pick Up Cargo',
      category: 'agv',
      color:    '#059669',
      icon:     '📦',
      inputs:   1,
      outputs:  1,
      params: [
        { name: 'cargo_id', label: 'Cargo ID', type: 'text', default: 'CARGO-A1' },
      ],
      execute: async (params) => {
        ROS.simLog(`📦 Pick up cargo ${params.cargo_id}`);
        ROS.publishString('/cargo_command', `pickup:${params.cargo_id}`);
        await sleep(700);
      },
    },
    {
      id:       'drop_cargo',
      label:    'Drop Cargo',
      category: 'agv',
      color:    '#059669',
      icon:     '📤',
      inputs:   1,
      outputs:  1,
      params: [
        { name: 'cargo_id', label: 'Cargo ID', type: 'text', default: 'CARGO-A1' },
      ],
      execute: async (params) => {
        ROS.simLog(`📤 Drop cargo ${params.cargo_id}`);
        ROS.publishString('/cargo_command', `drop:${params.cargo_id}`);
        await sleep(700);
      },
    },
    {
      id:       'charge',
      label:    'Go Charge',
      category: 'agv',
      color:    '#10b981',
      icon:     '🔋',
      inputs:   1,
      outputs:  1,
      params: [],
      execute: async () => {
        ROS.simLog('🔋 Navigating to charging station');
        ROS.publishString('/robot_command', 'charge');
        await sleep(3000);
      },
    },

    // ─────────── CONTROL ───────────
    {
      id:       'loop_start',
      label:    'Loop Start',
      category: 'control',
      color:    '#d97706',
      icon:     '🔄',
      /* Two inputs: entry from START/prior chain, repeat from Loop End (back-edge). */
      inputs:   2,
      inputLabels: ['enter', 'repeat'],
      outputs:  2, // 0 = body, 1 = exit
      outputLabels: ['body', 'exit'],
      params: [
        { name: 'iterations', label: 'Iterations', type: 'slider', min: 1, max: 100, step: 1, default: 3, unit: 'x' },
      ],
      execute: async () => { /* handled by executor */ },
    },
    {
      id:       'loop_end',
      label:    'Loop End',
      category: 'control',
      color:    '#b45309',
      icon:     '↩',
      inputs:   1,
      outputs:  1,
      params:   [],
      execute: async () => { /* handled by executor */ },
    },
    {
      id:       'wait',
      label:    'Wait / Delay',
      category: 'control',
      color:    '#92400e',
      icon:     '⏱',
      inputs:   1,
      outputs:  1,
      params: [
        { name: 'duration', label: 'Wait Time', type: 'slider', min: 0.5, max: 60, step: 0.5, default: 2, unit: 's' },
      ],
      execute: async (params) => {
        ROS.simLog(`⏱ Waiting ${params.duration}s…`);
        await sleep(params.duration * 1000);
      },
    },
    {
      id:       'emit_event',
      label:    'Emit Event',
      category: 'control',
      color:    '#78350f',
      icon:     '📣',
      inputs:   1,
      outputs:  1,
      params: [
        { name: 'event_name', label: 'Event Name', type: 'text', default: 'task_done' },
      ],
      execute: async (params) => {
        ROS.simLog(`📣 Event: ${params.event_name}`);
        ROS.publishString('/robot_events', params.event_name);
      },
    },

    // ─────────── SENSING ───────────
    {
      id:       'check_battery',
      label:    'Check Battery',
      category: 'sensing',
      color:    '#991b1b',
      icon:     '🔋',
      inputs:   1,
      outputs:  1,
      params: [],
      execute: async () => {
        ROS.simLog('🔋 Checking battery level…');
        ROS.publishString('/robot_command', 'check_battery');
        await sleep(500);
      },
    },
    {
      id:       'detect_obstacle',
      label:    'Detect Obstacle',
      category: 'sensing',
      color:    '#b91c1c',
      icon:     '📡',
      inputs:   1,
      outputs:  1,
      params: [
        { name: 'range', label: 'Range', type: 'slider', min: 0.1, max: 5.0, step: 0.1, default: 1.0, unit: 'm' },
      ],
      execute: async (params) => {
        ROS.simLog(`📡 Scan for obstacle within ${params.range}m`);
        ROS.publishString('/sensor_command', `scan:${params.range}`);
        await sleep(500);
      },
    },
    {
      id:       'read_position',
      label:    'Read Position',
      category: 'sensing',
      color:    '#dc2626',
      icon:     '📍',
      inputs:   1,
      outputs:  1,
      params:   [],
      execute: async () => {
        ROS.simLog('📍 Reading current position (odom)');
        ROS.publishString('/robot_command', 'get_position');
        await sleep(300);
      },
    },
  ];

  /* ── Lookup helpers ─────────────────────────────────────── */
  function getAll()        { return BLOCK_DEFS; }
  function get(id)         { return BLOCK_DEFS.find(b => b.id === id); }
  function getCategories() { return CATEGORIES; }

  function getBlockHeight(def) {
    if (!def) return HDR_H + 10;
    const paramRows  = (def.params || []).filter(p => p.type !== 'toggle').length;
    const toggleRows = (def.params || []).filter(p => p.type === 'toggle').length;
    return HDR_H + paramRows * BODY_H + toggleRows * 32 + 16;
  }

  return { getAll, get, getCategories, getBlockHeight, BLOCK_W, HDR_H, PORT_R };
})();

/* ── utility sleep ─────────────────────────────────────────── */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
