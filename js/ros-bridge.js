/**
 * RoboFlow — ROS Bridge
 * Wraps roslibjs for ROS 2 communication.
 * Falls back to simulation mode when robot is not connected.
 */
const ROS = (() => {
  /* ── State ─────────────────────────────────────────────── */
  let rosInstance    = null;
  let isSimulation   = true;
  let isConnected    = false;
  let reconnectTimer = null;
  let reconnectDelay = 2000;
  let publishers     = {};
  let simLogLines    = [];

  /* ── Settings ───────────────────────────────────────────── */
  let config = {
    url:            'ws://localhost:9090',
    cmdVelTopic:    '/cmd_vel',
    navTopic:       '/navigate_to_pose',
    maxLinear:       1.2,
    maxAngular:      2.4,
  };

  /* ── Status UI ──────────────────────────────────────────── */
  function setStatusUI(state) {
    const pill = document.getElementById('connection-status');
    const text = pill && pill.querySelector('.status-text');
    pill.className = 'status-pill ' + state;
    if (text) {
      text.textContent = {
        connected:    'Connected',
        disconnected: 'Disconnected',
        sim:          'Simulation',
        connecting:   'Connecting…',
        error:        'Error',
      }[state] || state;
    }
  }

  /* ── Simulation log ─────────────────────────────────────── */
  function simLog(msg) {
    const ts = new Date().toLocaleTimeString('en-US', { hour12: false });
    simLogLines.unshift(`[${ts}] ${msg}`);
    if (simLogLines.length > 40) simLogLines.pop();

    // Flow executor log
    const el = document.getElementById('exec-status-text');
    if (el) el.textContent = msg;

    // Remote log
    const remLog = document.getElementById('remote-sim-log-content');
    if (remLog) {
      remLog.innerHTML = simLogLines
        .slice(0, 12)
        .map(l => `<div class="sim-line">${l}</div>`)
        .join('');
    }
  }

  /* ── Init ───────────────────────────────────────────────── */
  function init() {
    setSimulationMode(true);
    simLog('RoboFlow ready — Simulation Mode active');
  }

  /* ── Connect to rosbridge ───────────────────────────────── */
  function connect(url) {
    if (!url) url = config.url;
    config.url = url;

    if (typeof ROSLIB === 'undefined') {
      showToast('roslibjs not loaded. Running in simulation mode.', 'warning');
      setSimulationMode(true);
      return;
    }

    isSimulation = false;
    setStatusUI('connecting');

    if (rosInstance) {
      try { rosInstance.close(); } catch (_) {}
    }

    rosInstance = new ROSLIB.Ros({ url });

    rosInstance.on('connection', () => {
      isConnected    = true;
      reconnectDelay = 2000;
      publishers     = {};
      setStatusUI('connected');
      showToast('Connected to ROS 2 robot!', 'success');
      simLog(`Connected to ${url}`);
      if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
      if (typeof window._roboflowOnRosConnected === 'function') {
        window._roboflowOnRosConnected(rosInstance);
      }
    });

    rosInstance.on('error', (err) => {
      isConnected = false;
      setStatusUI('error');
      simLog(`Connection error: ${err}`);
      scheduleReconnect(url);
    });

    rosInstance.on('close', () => {
      isConnected = false;
      setStatusUI('disconnected');
      simLog('Disconnected from robot');
      scheduleReconnect(url);
    });
  }

  function scheduleReconnect(url) {
    if (isSimulation) return;
    if (reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      reconnectDelay = Math.min(reconnectDelay * 1.5, 30000);
      connect(url);
    }, reconnectDelay);
  }

  /* ── Simulation mode toggle ─────────────────────────────── */
  function setSimulationMode(val) {
    isSimulation = val;
    isConnected  = val;
    if (val) {
      if (rosInstance) { try { rosInstance.close(); } catch (_) {} rosInstance = null; }
      if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
      publishers = {};
      setStatusUI('sim');
      simLog('Simulation Mode — No robot required');
    }
  }

  /* ── Publisher factory ──────────────────────────────────── */
  function getPublisher(topic, msgType) {
    if (isSimulation || !rosInstance) return null;
    if (!publishers[topic]) {
      publishers[topic] = new ROSLIB.Topic({ ros: rosInstance, name: topic, messageType: msgType });
    }
    return publishers[topic];
  }

  /* ── Publish ────────────────────────────────────────────── */
  function publish(topic, msgType, msg) {
    const prettyMsg = JSON.stringify(msg, null, 0)
      .replace(/"([^"]+)":/g, '$1:')
      .substring(0, 80);

    if (isSimulation) {
      simLog(`↗ ${topic}  ${prettyMsg}`);
      return Promise.resolve();
    }

    if (!isConnected) {
      simLog(`⚠ Not connected — dropped: ${topic}`);
      return Promise.reject(new Error('Not connected'));
    }

    const pub = getPublisher(topic, msgType);
    if (pub) {
      pub.publish(new ROSLIB.Message(msg));
      simLog(`↗ ${topic}  ${prettyMsg}`);
    }
    return Promise.resolve();
  }

  /* ── Convenience: cmd_vel ───────────────────────────────── */
  function publishCmdVel(linearX = 0, linearY = 0, angularZ = 0) {
    if (typeof window.SimRobot3D !== 'undefined' && window.SimRobot3D.applyCmdVel) {
      window.SimRobot3D.applyCmdVel(linearX, linearY, angularZ);
    }
    const topic = config.cmdVelTopic || '/cmd_vel';
    return publish(topic, 'geometry_msgs/Twist', {
      linear:  { x: linearX,  y: linearY,  z: 0 },
      angular: { x: 0,        y: 0,        z: angularZ },
    });
  }

  /* ── Convenience: stop ──────────────────────────────────── */
  function stop() {
    return publishCmdVel(0, 0, 0);
  }

  /* ── Convenience: navigate to pose (Nav2) ───────────────── */
  function navigateToPose(x, y, theta = 0) {
    const s3 = typeof window.SimRobot3D !== 'undefined' ? window.SimRobot3D : null;
    if (s3 && s3.navigateTo && !(s3.getFollowOdom && s3.getFollowOdom())) {
      s3.navigateTo(x, y, theta, 3);
    }
    return publish('/navigate_to_pose', 'nav2_msgs/NavigateToPose', {
      pose: {
        header: { frame_id: 'map' },
        pose: {
          position:    { x, y, z: 0 },
          orientation: { x: 0, y: 0, z: Math.sin(theta / 2), w: Math.cos(theta / 2) },
        },
      },
    });
  }

  /* ── Convenience: std_msgs/String ───────────────────────── */
  function publishString(topic, data) {
    if (topic === '/cargo_command' && typeof window.SimRobot3D !== 'undefined' && window.SimRobot3D.handleCargoCommand) {
      const ok = window.SimRobot3D.handleCargoCommand(data);
      simLog(
        ok
          ? `📦 Cargo command applied: ${data}`
          : `⚠ Cargo command failed (move closer to cargo for pickup; drop uses robot position unless drop:dock): ${data}`
      );
    }
    return publish(topic, 'std_msgs/String', { data });
  }

  /* ── Convenience: std_msgs/Bool ─────────────────────────── */
  function publishBool(topic, data) {
    return publish(topic, 'std_msgs/Bool', { data });
  }

  /* ── Config update ──────────────────────────────────────── */
  function updateConfig(newCfg) {
    Object.assign(config, newCfg);
  }

  /* ── Getters ─────────────────────────────────────────────── */
  function getConfig()       { return { ...config }; }
  function getIsConnected()  { return isConnected; }
  function getIsSimulation() { return isSimulation; }
  function getRos()          { return rosInstance; }

  /* ── Public API ──────────────────────────────────────────── */
  return {
    init,
    connect,
    setSimulationMode,
    publish,
    publishCmdVel,
    stop,
    navigateToPose,
    publishString,
    publishBool,
    updateConfig,
    getConfig,
    getIsConnected,
    getIsSimulation,
    getRos,
    simLog,
  };
})();
