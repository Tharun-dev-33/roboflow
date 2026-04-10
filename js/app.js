/**
 * RoboFlow — App Initialization & Routing
 */
document.addEventListener('DOMContentLoaded', () => {

  /* ── Initialize modules ─────────────────────────────────── */
  ROS.init();
  Remote.init();
  FlowEngine.init();  // Must come after ROS and Remote

  /* ── Mode switching ─────────────────────────────────────── */
  let currentMode = 'flow';

  function mountSimDock(mode) {
    const el =
      mode === 'flow'
        ? document.getElementById('sim3d-container-flow')
        : document.getElementById('sim3d-container-remote');
    if (!el || typeof SimRobot3D === 'undefined') return;
    SimRobot3D.initIfNeeded(el);
    requestAnimationFrame(() => SimRobot3D.resize());
  }

  function switchMode(mode) {
    currentMode = mode;

    const flowPanel   = document.getElementById('flow-panel');
    const remotePanel = document.getElementById('remote-panel');
    const execBar     = document.getElementById('execution-bar');
    const btnFlow     = document.getElementById('btn-flow-mode');
    const btnRemote   = document.getElementById('btn-remote-mode');

    function hidePanel(el) {
      if (!el) return;
      el.classList.remove('active');
      el.classList.add('hidden');
      el.style.pointerEvents = 'none';
      el.style.display = 'none';
    }

    function showPanel(el) {
      if (!el) return;
      el.classList.add('active');
      el.classList.remove('hidden');
      el.style.pointerEvents = '';
      el.style.display = '';
    }

    hidePanel(flowPanel);
    hidePanel(remotePanel);
    btnFlow.classList.remove('active');
    btnRemote.classList.remove('active');
    btnFlow.setAttribute('aria-selected', 'false');
    btnRemote.setAttribute('aria-selected', 'false');

    if (mode === 'flow') {
      showPanel(flowPanel);
      execBar.style.display = '';
      btnFlow.classList.add('active');
      btnFlow.setAttribute('aria-selected', 'true');
      Remote.onHide();
      mountSimDock('flow');
    } else {
      showPanel(remotePanel);
      execBar.style.display = 'none';
      btnRemote.classList.add('active');
      btnRemote.setAttribute('aria-selected', 'true');
      Remote.onShow();
      mountSimDock('remote');
    }
  }

  switchMode('flow');

  document.getElementById('btn-flow-mode').addEventListener('click',   () => switchMode('flow'));
  document.getElementById('btn-remote-mode').addEventListener('click', () => switchMode('remote'));

  /* ── 3D sim — sync controls across Flow + Remote docks ─── */
  function syncCameraRadios(val) {
    document.querySelectorAll('.js-sim-camera').forEach(inp => {
      inp.checked = inp.value === val;
    });
    if (typeof SimRobot3D !== 'undefined') SimRobot3D.setCameraMode(val);
  }

  function syncRoomRadios(val) {
    document.querySelectorAll('.js-sim-room').forEach(inp => {
      inp.checked = inp.value === val;
    });
    if (typeof SimRobot3D !== 'undefined') SimRobot3D.setRoomMode(val);
  }

  function syncMirrorCheckboxes(checked) {
    document.querySelectorAll('.js-sim-mirror-odom').forEach(cb => {
      cb.checked = checked;
    });
  }

  document.querySelectorAll('.js-sim-camera').forEach(inp => {
    inp.addEventListener('change', () => {
      if (inp.checked) syncCameraRadios(inp.value);
    });
  });

  document.querySelectorAll('.js-sim-room').forEach(inp => {
    inp.addEventListener('change', () => {
      if (inp.checked) syncRoomRadios(inp.value);
    });
  });

  document.querySelectorAll('.js-sim-reset').forEach(btn => {
    btn.addEventListener('click', () => {
      if (typeof SimRobot3D !== 'undefined') SimRobot3D.resetPose();
    });
  });

  function syncPathDrawButtons(on) {
    document.querySelectorAll('.js-sim-draw-path').forEach(btn => {
      btn.classList.toggle('active', !!on);
      btn.textContent = on ? 'Drawing…' : 'Draw path';
    });
  }

  document.querySelectorAll('.js-sim-draw-path').forEach(btn => {
    btn.addEventListener('click', () => {
      if (typeof SimRobot3D === 'undefined') return;
      const next = !SimRobot3D.isPathDrawMode();
      SimRobot3D.setPathDrawMode(next);
      syncPathDrawButtons(next);
    });
  });

  document.querySelectorAll('.js-sim-follow-path').forEach(btn => {
    btn.addEventListener('click', () => {
      if (typeof SimRobot3D === 'undefined') return;
      const ok = SimRobot3D.followDrawnPath();
      showToast(ok ? 'Following drawn path' : 'Draw a path first', ok ? 'success' : 'warning');
    });
  });

  document.querySelectorAll('.js-sim-clear-path').forEach(btn => {
    btn.addEventListener('click', () => {
      if (typeof SimRobot3D === 'undefined') return;
      SimRobot3D.clearDrawnPath();
      SimRobot3D.setPathDrawMode(false);
      syncPathDrawButtons(false);
    });
  });

  document.querySelectorAll('.js-voice-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      if (typeof VoiceControl !== 'undefined') VoiceControl.toggle();
    });
  });

  const SIM_TOOLBAR_COLLAPSED_LS = 'roboflow_sim_toolbar_collapsed';
  try {
    if (typeof SimRobot3D !== 'undefined' && localStorage.getItem(SIM_TOOLBAR_COLLAPSED_LS) === '1') {
      SimRobot3D.syncCollapsedUi(true);
    }
  } catch (_) {}

  document.querySelectorAll('.js-sim-collapse').forEach(btn => {
    btn.addEventListener('click', () => {
      const ref = document.getElementById('sim-dock-flow');
      const next = !(ref && ref.classList.contains('collapsed'));
      if (typeof SimRobot3D !== 'undefined') SimRobot3D.syncCollapsedUi(next);
      try {
        localStorage.setItem(SIM_TOOLBAR_COLLAPSED_LS, next ? '1' : '0');
      } catch (_) {}
    });
  });

  function syncOdomMirror() {
    if (typeof SimRobot3D === 'undefined') return;
    const cbs = document.querySelectorAll('.js-sim-mirror-odom');
    const on = cbs.length && cbs[0].checked;
    syncMirrorCheckboxes(!!on);
    SimRobot3D.setFollowOdom(!!on);
    SimRobot3D.detachOdom();
    if (on && typeof ROSLIB !== 'undefined' && ROS.getIsConnected()) {
      const ros = ROS.getRos();
      if (ros) SimRobot3D.attachRosOdom(ros, '/odom');
    }
  }

  document.querySelectorAll('.js-sim-mirror-odom').forEach(cb => {
    cb.addEventListener('change', () => {
      syncMirrorCheckboxes(cb.checked);
      syncOdomMirror();
    });
  });

  window._roboflowOnRosConnected = function (ros) {
    const cbs = document.querySelectorAll('.js-sim-mirror-odom');
    if (cbs.length && cbs[0].checked && typeof SimRobot3D !== 'undefined') {
      SimRobot3D.setFollowOdom(true);
      SimRobot3D.attachRosOdom(ros, '/odom');
    }
  };

  window.addEventListener('resize', () => {
    if (typeof SimRobot3D !== 'undefined') SimRobot3D.resize();
  });

  /* ── Resize handles for 3D dock width ───────────────────── */
  function setupSimResize(handle, rootEl, cssVar) {
    if (!handle || !rootEl) return;
    let dragging = false;
    let startX = 0;
    let startW = 0;

    handle.addEventListener('mousedown', e => {
      dragging = true;
      startX = e.clientX;
      const dock = cssVar.includes('remote')
        ? document.getElementById('sim-dock-remote')
        : document.getElementById('sim-dock-flow');
      startW = dock ? dock.getBoundingClientRect().width : 320;
      e.preventDefault();
    });

    window.addEventListener('mousemove', e => {
      if (!dragging) return;
      const dw = e.clientX - startX;
      const newW = Math.max(200, Math.min(window.innerWidth * 0.52, startW + dw));
      rootEl.style.setProperty(cssVar, `${Math.round(newW)}px`);
    });

    window.addEventListener('mouseup', () => {
      dragging = false;
    });
  }

  setupSimResize(
    document.getElementById('sim-resize-flow'),
    document.getElementById('flow-panel'),
    '--sim-dock-width'
  );
  setupSimResize(
    document.getElementById('sim-resize-remote'),
    document.getElementById('remote-panel'),
    '--sim-dock-width-remote'
  );

  const BACKEND_LS = 'roboflow_backend_url';
  const backendUrlInput = document.getElementById('backend-url');

  const VOICE_LS = {
    llmBackend: 'roboflow_voice_llm_backend',
    llmDirect: 'roboflow_voice_llm_direct',
    speakReplies: 'roboflow_voice_speak_replies',
    pauseMicTts: 'roboflow_voice_pause_mic_tts',
    openaiKey: 'roboflow_openai_key',
    openaiBase: 'roboflow_openai_base',
    openaiModel: 'roboflow_openai_model',
  };

  function persistVoiceSettings() {
    const b = document.getElementById('voice-llm-backend');
    const d = document.getElementById('voice-llm-direct');
    const sp = document.getElementById('voice-speak-replies');
    const pm = document.getElementById('voice-pause-mic-tts');
    const key = document.getElementById('voice-openai-key');
    const base = document.getElementById('voice-openai-base');
    const model = document.getElementById('voice-openai-model');
    if (b) localStorage.setItem(VOICE_LS.llmBackend, b.checked ? '1' : '0');
    if (d) localStorage.setItem(VOICE_LS.llmDirect, d.checked ? '1' : '0');
    if (sp) localStorage.setItem(VOICE_LS.speakReplies, sp.checked ? '1' : '0');
    if (pm) localStorage.setItem(VOICE_LS.pauseMicTts, pm.checked ? '1' : '0');
    if (key) localStorage.setItem(VOICE_LS.openaiKey, key.value.trim());
    if (base) localStorage.setItem(VOICE_LS.openaiBase, base.value.trim());
    if (model) localStorage.setItem(VOICE_LS.openaiModel, model.value.trim());
  }

  function loadVoiceSettingsIntoForm() {
    const b = document.getElementById('voice-llm-backend');
    const d = document.getElementById('voice-llm-direct');
    const sp = document.getElementById('voice-speak-replies');
    const pm = document.getElementById('voice-pause-mic-tts');
    const key = document.getElementById('voice-openai-key');
    const base = document.getElementById('voice-openai-base');
    const model = document.getElementById('voice-openai-model');
    if (b) b.checked = localStorage.getItem(VOICE_LS.llmBackend) === '1';
    if (d) d.checked = localStorage.getItem(VOICE_LS.llmDirect) === '1';
    if (sp) sp.checked = localStorage.getItem(VOICE_LS.speakReplies) === '1';
    if (pm) pm.checked = localStorage.getItem(VOICE_LS.pauseMicTts) !== '0';
    if (key) key.value = localStorage.getItem(VOICE_LS.openaiKey) || '';
    if (base) base.value = localStorage.getItem(VOICE_LS.openaiBase) || 'https://api.openai.com/v1';
    if (model) model.value = localStorage.getItem(VOICE_LS.openaiModel) || 'gpt-4o-mini';
  }

  function getBackendBase() {
    const v = (backendUrlInput?.value || localStorage.getItem(BACKEND_LS) || '')
      .trim()
      .replace(/\/$/, '');
    return v || '';
  }

  function persistBackendUrl() {
    if (backendUrlInput) {
      localStorage.setItem(BACKEND_LS, backendUrlInput.value.trim());
    }
  }

  /* ── Settings drawer ─────────────────────────────────────── */
  function openSettings() {
    document.getElementById('settings-drawer').classList.remove('hidden');
    document.getElementById('settings-overlay').classList.remove('hidden');
    if (backendUrlInput) {
      backendUrlInput.value = localStorage.getItem(BACKEND_LS) || '';
    }
    loadVoiceSettingsIntoForm();
  }

  function closeSettings() {
    document.getElementById('settings-drawer').classList.add('hidden');
    document.getElementById('settings-overlay').classList.add('hidden');
  }

  document.getElementById('btn-settings').addEventListener('click', openSettings);
  document.getElementById('btn-close-settings')?.addEventListener('click', closeSettings);
  document.getElementById('settings-overlay').addEventListener('click', closeSettings);

  backendUrlInput?.addEventListener('change', persistBackendUrl);
  backendUrlInput?.addEventListener('blur', persistBackendUrl);

  document.getElementById('voice-llm-backend')?.addEventListener('change', persistVoiceSettings);
  document.getElementById('voice-llm-direct')?.addEventListener('change', persistVoiceSettings);
  document.getElementById('voice-openai-key')?.addEventListener('blur', persistVoiceSettings);
  document.getElementById('voice-openai-base')?.addEventListener('blur', persistVoiceSettings);
  document.getElementById('voice-openai-model')?.addEventListener('blur', persistVoiceSettings);
  document.getElementById('voice-speak-replies')?.addEventListener('change', persistVoiceSettings);
  document.getElementById('voice-pause-mic-tts')?.addEventListener('change', persistVoiceSettings);

  document.getElementById('btn-backend-test')?.addEventListener('click', async () => {
    const base = getBackendBase();
    if (!base) {
      showToast('Enter the backend URL first', 'warning');
      return;
    }
    try {
      const r = await fetch(`${base}/api/health`, { method: 'GET' });
      const j = await r.json();
      if (j.ok) showToast(`Backend OK — ${base}`, 'success');
      else showToast('Backend returned an unexpected response', 'warning');
    } catch (err) {
      showToast(`Cannot reach backend: ${err.message}`, 'error');
    }
  });

  /* ── Connection controls ─────────────────────────────────── */
  if (typeof VoiceControl !== 'undefined') VoiceControl.init();

  document.getElementById('btn-connect').addEventListener('click', () => {
    const url      = document.getElementById('ros-url').value.trim();
    const simBtn   = document.getElementById('btn-simulate');
    simBtn.classList.remove('active');
    ROS.connect(url);
  });

  document.getElementById('btn-simulate').addEventListener('click', () => {
    const btn = document.getElementById('btn-simulate');
    const isActive = btn.classList.toggle('active');
    ROS.setSimulationMode(isActive);
    if (isActive) showToast('Simulation Mode active — no robot needed', 'info');
  });

  /* ── Settings — speed sliders ────────────────────────────── */
  const maxLinearSlider = document.getElementById('max-linear-speed');
  const maxLinearVal    = document.getElementById('max-linear-speed-val');
  maxLinearSlider?.addEventListener('input', () => {
    const v = parseFloat(maxLinearSlider.value);
    maxLinearVal.textContent = v.toFixed(1) + ' m/s';
    ROS.updateConfig({ maxLinear: v });
  });

  const maxAngularSlider = document.getElementById('max-angular-speed');
  const maxAngularVal    = document.getElementById('max-angular-speed-val');
  maxAngularSlider?.addEventListener('input', () => {
    const v = parseFloat(maxAngularSlider.value);
    maxAngularVal.textContent = v.toFixed(1) + ' rad/s';
    ROS.updateConfig({ maxAngular: v });
  });

  /* ── Settings — topic inputs ─────────────────────────────── */
  document.getElementById('cmd-vel-topic')?.addEventListener('change', e => {
    ROS.updateConfig({ cmdVelTopic: e.target.value });
  });

  /* ── Execution controls ──────────────────────────────────── */
  document.getElementById('btn-run').addEventListener('click', FlowExecutor.run);
  document.getElementById('btn-pause').addEventListener('click', FlowExecutor.pause);
  document.getElementById('btn-stop-exec').addEventListener('click', FlowExecutor.stop);

  document.getElementById('btn-run-ros2')?.addEventListener('click', async () => {
    const base = getBackendBase();
    if (!base) {
      showToast('Set ROS 2 backend URL in Settings (Ubuntu)', 'warning');
      openSettings();
      return;
    }
    const payload = FlowEngine.serialize();
    try {
      let r = await fetch(`${base}/api/flow`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
      });
      let t = await r.text();
      if (!r.ok) throw new Error(t || r.statusText);
      r = await fetch(`${base}/api/run`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      t = await r.text();
      if (!r.ok) throw new Error(t || r.statusText);
      showToast('Flow sent — running on ROS 2 backend', 'success');
    } catch (err) {
      showToast(`ROS 2 backend: ${err.message}`, 'error');
    }
  });

  /* ── Save ────────────────────────────────────────────────── */
  document.getElementById('btn-save').addEventListener('click', () => {
    const data = FlowEngine.serialize();
    const blob = new Blob([data], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `roboflow-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Flow saved!', 'success');
  });

  /* ── Load ────────────────────────────────────────────────── */
  document.getElementById('btn-load').addEventListener('click', () => {
    document.getElementById('load-file-input').click();
  });

  document.getElementById('load-file-input').addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => FlowEngine.deserialize(ev.target.result);
    reader.readAsText(file);
    e.target.value = '';
  });

  /* ── Clear ───────────────────────────────────────────────── */
  document.getElementById('btn-clear').addEventListener('click', () => {
    if (confirm('Clear the canvas? This will remove all blocks and connections.')) {
      FlowEngine.clearAll();
    }
  });

  /* ── Global keyboard shortcuts ───────────────────────────── */
  document.addEventListener('keydown', e => {
    if (['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName)) return;
    if (e.ctrlKey && e.key === ',') { e.preventDefault(); openSettings(); }
    if (e.ctrlKey && e.key === 's') { e.preventDefault(); document.getElementById('btn-save').click(); }
  });

  /* ── Status pill click → open settings ──────────────────── */
  document.getElementById('connection-status').addEventListener('click', openSettings);
});

/* ════════════════════════════════════════
   GLOBAL TOAST NOTIFICATION
════════════════════════════════════════ */
function showToast(message, type = 'info', duration = 3000) {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  const icons = { success: '✅', error: '🚨', warning: '⚠️', info: 'ℹ️' };
  toast.innerHTML = `<span class="toast-icon">${icons[type] || 'ℹ️'}</span><span class="toast-msg">${message}</span>`;

  container.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('visible'));

  setTimeout(() => {
    toast.classList.remove('visible');
    setTimeout(() => toast.remove(), 400);
  }, duration);
}
