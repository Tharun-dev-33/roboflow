/**
 * RoboFlow — Virtual Joystick Remote Controller
 * Uses nipplejs for touch+mouse joysticks.
 * Publishes geometry_msgs/Twist to /cmd_vel at ~10Hz.
 */
const Remote = (() => {

  /* ── State ─────────────────────────────────────────────── */
  let leftJoystick  = null;
  let rightJoystick = null;
  let publishTimer  = null;
  let estopActive   = false;
  let lightsOn      = false;

  let cmdLinearX  = 0;
  let cmdLinearY  = 0;
  let cmdAngularZ = 0;

  let speedPct    = 0.5;     // 0–1
  let maxLinear   = 1.2;
  let maxAngular  = 2.4;

  // Keyboard tracking
  const keysDown = new Set();

  /* ── Init ───────────────────────────────────────────────── */
  function init() {
    bindSpeedSlider();
    bindActionButtons();
    bindKeyboard();
    // Joysticks created when panel becomes visible
  }

  /* ── Create joysticks ───────────────────────────────────── */
  function createJoysticks() {
    if (leftJoystick)  { leftJoystick.destroy();  leftJoystick  = null; }
    if (rightJoystick) { rightJoystick.destroy(); rightJoystick = null; }

    // Movement joystick (left) — controls linear X/Y
    const ljZone = document.getElementById('joystick-movement-zone');
    if (ljZone && window.nipplejs) {
      leftJoystick = window.nipplejs.create({
        zone:       ljZone,
        mode:       'static',
        position:   { left: '50%', top: '50%' },
        color:      '#00d4ff',
        size:       110,
        restOpacity: 0.7,
      });

      leftJoystick.on('move', (_, data) => {
        if (estopActive) return;
        const radian  = data.angle.radian;
        const power   = Math.min(data.distance / 55, 1.0);
        /* Nipple: 0 rad = right, π/2 = up (screen). ROS: linear.x = forward, linear.y = lateral (left +). */
        cmdLinearX  = Math.sin(radian) * power * maxLinear * speedPct;
        cmdLinearY  = -Math.cos(radian) * power * maxLinear * speedPct;
        updateReadouts();
      });

      leftJoystick.on('end', () => {
        cmdLinearX = 0;
        cmdLinearY = 0;
        updateReadouts();
      });
    }

    // Rotation joystick (right) — controls angular Z
    const rjZone = document.getElementById('joystick-rotation-zone');
    if (rjZone && window.nipplejs) {
      rightJoystick = window.nipplejs.create({
        zone:       rjZone,
        mode:       'static',
        position:   { left: '50%', top: '50%' },
        color:      '#ff8c00',
        size:       110,
        restOpacity: 0.7,
      });

      rightJoystick.on('move', (_, data) => {
        if (estopActive) return;
        const radian = data.angle.radian;
        const power  = Math.min(data.distance / 55, 1.0);
        /* Horizontal deflection: left → +ω (CCW), right → −ω (CW). Nipple 0=right, π=left. */
        cmdAngularZ = -Math.cos(radian) * power * maxAngular * speedPct;
        updateReadouts();
      });

      rightJoystick.on('end', () => {
        cmdAngularZ = 0;
        updateReadouts();
      });
    }

    startPublishLoop();
  }

  /* ── 10Hz publish loop ──────────────────────────────────── */
  function startPublishLoop() {
    if (publishTimer) return;
    publishTimer = setInterval(() => {
      if (estopActive) {
        ROS.publishCmdVel(0, 0, 0);
        return;
      }
      // Add keyboard contribution
      let lx = cmdLinearX;
      let ly = cmdLinearY;
      let az = cmdAngularZ;

      if (keysDown.size > 0) {
        const kSpeed = maxLinear * speedPct;
        const kTurn  = maxAngular * speedPct;
        if (keysDown.has('ArrowUp')    || keysDown.has('w') || keysDown.has('W')) lx += kSpeed;
        if (keysDown.has('ArrowDown')  || keysDown.has('s') || keysDown.has('S')) lx -= kSpeed;
        /* Left key → turn left (CCW, +ω); right key → turn right. (Previously inverted.) */
        if (keysDown.has('ArrowLeft')  || keysDown.has('a') || keysDown.has('A')) az -= kTurn;
        if (keysDown.has('ArrowRight') || keysDown.has('d') || keysDown.has('D')) az += kTurn;
        lx = Math.max(-maxLinear, Math.min(maxLinear, lx));
        az = Math.max(-maxAngular, Math.min(maxAngular, az));
      }

      ROS.publishCmdVel(lx, ly, az);
      updateHUD(lx, ly, az);
    }, 100); // 10 Hz
  }

  function stopPublishLoop() {
    if (publishTimer) { clearInterval(publishTimer); publishTimer = null; }
    if (leftJoystick)  { leftJoystick.destroy();  leftJoystick  = null; }
    if (rightJoystick) { rightJoystick.destroy(); rightJoystick = null; }
    cmdLinearX = 0; cmdLinearY = 0; cmdAngularZ = 0;
    ROS.publishCmdVel(0, 0, 0);
  }

  /* ── Visual readouts ─────────────────────────────────────── */
  function updateReadouts() {
    const lxEl = document.getElementById('val-lx');
    const lyEl = document.getElementById('val-ly');
    const rzEl = document.getElementById('val-rz');
    if (lxEl) lxEl.textContent = cmdLinearX.toFixed(3);
    if (lyEl) lyEl.textContent = cmdLinearY.toFixed(3);
    if (rzEl) rzEl.textContent = cmdAngularZ.toFixed(3);
  }

  function updateHUD(lx, ly, az) {
    const speed = Math.sqrt(lx * lx + ly * ly);
    const speedEl = document.getElementById('speed-val-display');
    if (speedEl) speedEl.textContent = speed.toFixed(2);

    const arrow  = document.getElementById('direction-arrow');
    if (!arrow) return;
    if (lx > 0.05)        arrow.textContent = '⬆';
    else if (lx < -0.05)  arrow.textContent = '⬇';
    else if (az > 0.05)   arrow.textContent = '⬅';
    else if (az < -0.05)  arrow.textContent = '➡';
    else                  arrow.textContent = '●';

    // Ring glow based on speed
    const ring = document.getElementById('robot-status-ring');
    if (ring) {
      const intensity = Math.min(speed / maxLinear, 1);
      const color = estopActive
        ? '#ff3366'
        : `rgba(0, ${Math.round(180 + 75 * intensity)}, ${Math.round(255 * (1 - intensity * 0.4))}, ${0.4 + intensity * 0.6})`;
      ring.style.boxShadow = `0 0 ${20 + intensity * 30}px ${color}`;
    }
  }

  /* ── Speed slider ───────────────────────────────────────── */
  function bindSpeedSlider() {
    const slider = document.getElementById('remote-speed-limit');
    const label  = document.getElementById('remote-speed-pct');
    if (!slider) return;
    slider.addEventListener('input', () => {
      speedPct = slider.value / 100;
      if (label) label.textContent = slider.value + '%';
    });
  }

  /* ── Update maxLinear/Angular from settings ─────────────── */
  function applySpeedSettings() {
    const cfg = ROS.getConfig();
    maxLinear  = cfg.maxLinear;
    maxAngular = cfg.maxAngular;
  }

  /* ── Action buttons ─────────────────────────────────────── */
  function bindActionButtons() {
    const estopBtn = document.getElementById('btn-estop');
    if (estopBtn) {
      estopBtn.addEventListener('click', () => toggleEstop());
    }

    document.getElementById('btn-dock')?.addEventListener('click', () => {
      ROS.publishString('/dock_command', 'dock');
      showToast('Dock command sent', 'info');
      ROS.simLog('⚓ Dock command sent');
    });

    document.getElementById('btn-undock')?.addEventListener('click', () => {
      ROS.publishString('/dock_command', 'undock');
      showToast('Undock command sent', 'info');
      ROS.simLog('🚀 Undock command sent');
    });

    document.getElementById('btn-go-home')?.addEventListener('click', () => {
      ROS.navigateToPose(0, 0, 0);
      showToast('Navigating to home…', 'info');
      ROS.simLog('🏠 Navigate to home (0, 0, 0)');
    });

    document.getElementById('btn-lights-toggle')?.addEventListener('click', () => {
      lightsOn = !lightsOn;
      ROS.publishBool('/lights', lightsOn);
      ROS.simLog(`💡 Lights: ${lightsOn ? 'ON' : 'OFF'}`);
      const btn = document.getElementById('btn-lights-toggle');
      if (btn) btn.classList.toggle('active', lightsOn);
    });

    document.getElementById('btn-horn')?.addEventListener('click', () => {
      ROS.publishString('/robot_command', 'horn');
      ROS.simLog('📢 Horn!');
      // Visual feedback
      const btn = document.getElementById('btn-horn');
      if (btn) { btn.classList.add('active'); setTimeout(() => btn.classList.remove('active'), 500); }
    });
  }

  function toggleEstop() {
    estopActive = !estopActive;
    ROS.publishCmdVel(0, 0, 0);
    const btn = document.getElementById('btn-estop');
    if (btn) {
      btn.classList.toggle('active', estopActive);
      btn.querySelector('.action-btn-label').textContent = estopActive ? 'RESUME' : 'E-STOP';
    }
    if (estopActive) {
      showToast('🛑 Emergency Stop activated — all motion halted', 'error', 4000);
      ROS.simLog('⛔ EMERGENCY STOP ACTIVATED');
      // Haptic feedback on mobile
      if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
    } else {
      showToast('✅ E-Stop released — ready to drive', 'success');
      ROS.simLog('✅ Emergency stop released');
    }
  }

  /* ── Keyboard control ───────────────────────────────────── */
  function bindKeyboard() {
    window.addEventListener('keydown', e => {
      if (['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName)) return;
      // Only intercept in remote panel
      const remotePanel = document.getElementById('remote-panel');
      if (remotePanel && remotePanel.classList.contains('hidden')) return;

      const key = e.key;
      if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','w','W','a','A','s','S','d','D'].includes(key)) {
        e.preventDefault();
        keysDown.add(key);
      }
      if (key === ' ') { e.preventDefault(); toggleEstop(); }
    });

    window.addEventListener('keyup', e => {
      keysDown.delete(e.key);
    });
  }

  /* ── Called when switching to remote mode ───────────────── */
  function onShow() {
    applySpeedSettings();
    // Small delay to ensure panel is visible before nipplejs reads layout
    setTimeout(() => {
      createJoysticks();
      startPublishLoop();
    }, 100);
  }

  /* ── Called when leaving remote mode ─────────────────────── */
  function onHide() {
    stopPublishLoop();
    keysDown.clear();
  }

  return { init, onShow, onHide };
})();
