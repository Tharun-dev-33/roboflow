/**
 * RoboFlow — Voice: Web Speech input + optional LLM (commands + conversational replies) + TTS
 */
const VoiceControl = (() => {
  let recognition = null;
  let listening = false;
  /** User wants mic session (stays true through TTS pause / recognition restarts) */
  let voiceArmed = false;
  let pauseMicForTts = false;

  const LS = {
    useLlmBackend: 'roboflow_voice_llm_backend',
    useLlmDirect: 'roboflow_voice_llm_direct',
    speakReplies: 'roboflow_voice_speak_replies',
    pauseMicTts: 'roboflow_voice_pause_mic_tts',
    openaiKey: 'roboflow_openai_key',
    openaiBase: 'roboflow_openai_base',
    openaiModel: 'roboflow_openai_model',
  };

  function useSpeakReplies() {
    return localStorage.getItem(LS.speakReplies) === '1';
  }

  function usePauseMicTts() {
    return localStorage.getItem(LS.pauseMicTts) !== '0';
  }

  function toCargoId(text) {
    const m = String(text || '').toUpperCase().match(/CARGO[\s-]*([A-Z])[\s-]*(\d)/);
    if (m) return `CARGO-${m[1]}${m[2]}`;
    const any = String(text || '').toUpperCase().match(/CARGO[\s-]*([A-Z0-9]+)/);
    if (any) return `CARGO-${any[1]}`;
    return '';
  }

  function driveFor(lx, az = 0, seconds = 1.2) {
    ROS.publishCmdVel(lx, 0, az);
    setTimeout(() => ROS.publishCmdVel(0, 0, 0), Math.max(0.2, seconds) * 1000);
  }

  function rotateVoiceLeft() {
    if (typeof ROS !== 'undefined' && !ROS.getIsSimulation()) {
      const w = Math.min(1.85, (ROS.getConfig().maxAngular || 2.4) * 0.88);
      driveFor(0, -w, 1.35);
      return;
    }
    if (window.SimRobot3D?.rotateInPlace) window.SimRobot3D.rotateInPlace(-1.28, 1.28);
    else driveFor(0, -1.65, 1.35);
  }

  function rotateVoiceRight() {
    if (typeof ROS !== 'undefined' && !ROS.getIsSimulation()) {
      const w = Math.min(1.85, (ROS.getConfig().maxAngular || 2.4) * 0.88);
      driveFor(0, w, 1.35);
      return;
    }
    if (window.SimRobot3D?.rotateInPlace) window.SimRobot3D.rotateInPlace(1.28, 1.28);
    else driveFor(0, 1.65, 1.35);
  }

  function wantsRotateLeftPhrase(t) {
    return (
      (t.includes('rotate') && t.includes('left')) ||
      t.includes('turn left') ||
      t.includes('spin left') ||
      t.includes('rotating left')
    );
  }

  function wantsRotateRightPhrase(t) {
    return (
      (t.includes('rotate') && t.includes('right')) ||
      t.includes('turn right') ||
      t.includes('spin right') ||
      t.includes('rotating right')
    );
  }

  function defaultParamsForBlock(blockId) {
    const def = typeof FlowBlocks !== 'undefined' ? FlowBlocks.get(blockId) : null;
    if (!def?.params) return {};
    const o = {};
    for (const p of def.params) {
      if (p.type === 'slider' || p.type === 'number') o[p.name] = p.default;
      else if (p.type === 'text') o[p.name] = p.default;
      else if (p.type === 'toggle') o[p.name] = p.default;
    }
    return o;
  }

  function runFlowBlock(blockId, overrides = {}) {
    if (typeof FlowBlocks === 'undefined') return false;
    const def = FlowBlocks.get(blockId);
    if (!def?.execute) return false;
    const params = { ...defaultParamsForBlock(blockId), ...overrides };
    ROS.simLog(`🎤 Voice → ${def.label || blockId}`);
    Promise.resolve(def.execute(params)).catch(() => {});
    return true;
  }

  function parseTwoFloats(t) {
    const nums = t.match(/-?\d+\.?\d*/g);
    if (nums && nums.length >= 2) return { x: parseFloat(nums[0]), y: parseFloat(nums[1]) };
    return null;
  }

  function parseStationId(t) {
    const m = t.match(/station\s*#?\s*(\d+)/);
    return m ? parseInt(m[1], 10) : 1;
  }

  function parseWaitSeconds(t) {
    const m = t.match(/(\d+\.?\d*)\s*(second|sec|s)\b/);
    if (m) return parseFloat(m[1]);
    const m2 = t.match(/\b(\d+)\b/);
    return m2 ? parseInt(m2[1], 10) : null;
  }

  function parseFirstHeadingDeg(t) {
    const m = t.match(/heading\s*(-?\d+)/);
    if (m) return parseInt(m[1], 10);
    const m2 = t.match(/\b(\d+)\s*degrees?\b/);
    return m2 ? parseInt(m2[1], 10) : null;
  }

  function getBackendBase() {
    const el = document.getElementById('backend-url');
    const v = (el?.value || localStorage.getItem('roboflow_backend_url') || '').trim().replace(/\/$/, '');
    return v || '';
  }

  function useLlmBackend() {
    return localStorage.getItem(LS.useLlmBackend) === '1';
  }

  function useLlmDirect() {
    return localStorage.getItem(LS.useLlmDirect) === '1';
  }

  function useAnyLlm() {
    return useLlmBackend() || useLlmDirect();
  }

  function getOpenaiDirect() {
    return {
      key: (localStorage.getItem(LS.openaiKey) || '').trim(),
      base: (localStorage.getItem(LS.openaiBase) || 'https://api.openai.com/v1').trim().replace(/\/$/, ''),
      model: (localStorage.getItem(LS.openaiModel) || 'gpt-4o-mini').trim(),
    };
  }

  const LLM_SYSTEM = `You parse spoken commands for a mobile robot in a warehouse sim. Reply with ONLY valid minified JSON (no markdown), exactly this shape: {"commands":["..."]}
Each string in "commands" must be ONE of these exact tokens (use multiple strings for multiple intents, in order):
- pickup:any — drive to nearest cargo then pick up (use when user does not name a box)
- pickup:CARGO-A1 — pick a specific id (only if user names it; ids look like CARGO-A1, CARGO-B2)
- drop:here — set cargo down on the floor near the robot (default drop)
- drop:dock — only if user explicitly wants the loading dock/station
- drop:CARGO-A1 — drop while carrying that id (optional id check)
- stop
- home
- draw_path — enable drawing a path on the floor
- follow_path
- clear_path
- forward — move forward ~1.4s
- back — reverse ~1.2s
- left — rotate the robot left (~90° in sim)
- right — rotate the robot right (~90° in sim)
If unsure, prefer pickup:any and drop:here. Empty commands array if unrelated chit-chat.`;

  const LLM_CHAT_SYSTEM = `You are a friendly autonomous warehouse robot (AMR) in a simulation. The operator speaks to you.
Reply with ONLY valid minified JSON (no markdown), exactly: {"reply":"...","commands":[]}

Field "reply": what you say out loud via text-to-speech — 1–3 short, natural sentences, first person as the robot.
Stay under about 220 characters. Escape any internal double quotes. No markdown.

Field "commands": machine tokens (array of strings, may be empty):
- pickup:any, pickup:CARGO-A1, drop:here, drop:dock, drop:CARGO-A1
- stop, home, draw_path, follow_path, clear_path, forward, back, left, right

If the user is only chatting, use commands: [] and a brief reply.
If they ask for an action, acknowledge in reply and include matching commands in order.
If unsure, prefer pickup:any and drop:here for cargo tasks.`;

  function parseLlmJsonContent(content) {
    const cleaned = String(content || '')
      .trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/i, '');
    return JSON.parse(cleaned);
  }

  async function openaiChatCompletionFixed(text, key, base, model, system, temperature) {
    const url = `${base}/chat/completions`;
    const r = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model,
        temperature,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: `Transcript: "${text}"` },
        ],
      }),
    });
    if (!r.ok) {
      const errText = await r.text();
      throw new Error(errText.slice(0, 200) || r.statusText);
    }
    const j = await r.json();
    const content = j.choices?.[0]?.message?.content;
    if (!content) throw new Error('No model content');
    return parseLlmJsonContent(content);
  }

  async function parseWithOpenaiCompatible(text, key, base, model) {
    const parsed = await openaiChatCompletionFixed(text, key, base, model, LLM_SYSTEM, 0.1);
    const cmds = parsed.commands;
    if (!Array.isArray(cmds)) throw new Error('Invalid JSON shape');
    return cmds.map(c => String(c).trim()).filter(Boolean);
  }

  async function chatWithOpenaiCompatible(text, key, base, model) {
    const parsed = await openaiChatCompletionFixed(text, key, base, model, LLM_CHAT_SYSTEM, 0.35);
    const reply = String(parsed.reply || '').trim();
    const cmds = parsed.commands;
    if (!Array.isArray(cmds)) throw new Error('Invalid JSON shape');
    return {
      reply,
      commands: cmds.map(c => String(c).trim()).filter(Boolean),
    };
  }

  async function parseWithBackend(text) {
    const base = getBackendBase();
    if (!base) throw new Error('Set backend URL in Settings');
    const r = await fetch(`${base}/api/voice/parse`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || 'Voice parse failed');
    const cmds = j.commands;
    if (!Array.isArray(cmds)) throw new Error('Bad response');
    return cmds.map(c => String(c).trim()).filter(Boolean);
  }

  async function chatWithBackend(text) {
    const base = getBackendBase();
    if (!base) throw new Error('Set backend URL in Settings');
    const r = await fetch(`${base}/api/voice/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || 'Voice chat failed');
    const cmds = j.commands;
    if (!Array.isArray(cmds)) throw new Error('Bad response');
    return {
      reply: String(j.reply || '').trim(),
      commands: cmds.map(c => String(c).trim()).filter(Boolean),
    };
  }

  function speakReply(text) {
    const t = String(text || '').trim();
    if (!t || typeof window.speechSynthesis === 'undefined') {
      if (t) showToast('Speech synthesis not available in this browser', 'warning');
      return;
    }
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(t);
    utter.lang = 'en-US';
    utter.rate = 0.96;
    utter.pitch = 1;

    const pauseMic = usePauseMicTts() && voiceArmed && recognition && listening;
    if (pauseMic) {
      pauseMicForTts = true;
      try {
        recognition.stop();
      } catch (_) {}
    }

    const resume = () => {
      pauseMicForTts = false;
      if (pauseMic && voiceArmed && recognition) {
        try {
          recognition.start();
        } catch (_) {}
      }
    };
    utter.onend = resume;
    utter.onerror = resume;

    window.speechSynthesis.speak(utter);
  }

  function executeParsedCommand(cmd) {
    const s = String(cmd || '').trim();
    if (!s) return;
    const low = s.toLowerCase();

    if (low === 'stop') return ROS.stop();
    if (low === 'home') return ROS.navigateToPose(0, 0, 0);

    if (low.startsWith('pickup:')) return ROS.publishString('/cargo_command', s);
    if (low.startsWith('drop:')) return ROS.publishString('/cargo_command', s);

    if (low === 'draw_path') return window.SimRobot3D?.setPathDrawMode?.(true);
    if (low === 'follow_path') {
      if (window.SimRobot3D?.followDrawnPath?.()) showToast('Following drawn path', 'success');
      else showToast('Draw a path first', 'warning');
      return;
    }
    if (low === 'clear_path') return window.SimRobot3D?.clearDrawnPath?.();

    if (low === 'forward') return driveFor(0.7, 0, 1.4);
    if (low === 'back') return driveFor(-0.6, 0, 1.2);
    if (low === 'left') return rotateVoiceLeft();
    if (low === 'right') return rotateVoiceRight();
  }

  function handleCommandLocal(raw) {
    const t = String(raw || '').trim().toLowerCase();
    if (!t) return;
    ROS.simLog(`🎤 Voice: "${t}"`);

    /* ── Flow canvas (matches Start / Run / Pause / Stop blocks) ── */
    if (/\bflow\b/.test(t) && /\b(run|execute|play|start)\b/.test(t)) {
      if (typeof FlowExecutor !== 'undefined') FlowExecutor.run();
      return;
    }
    if (/\bflow\b/.test(t) && /\bpause\b/.test(t)) {
      if (typeof FlowExecutor !== 'undefined') FlowExecutor.pause();
      return;
    }
    if (/\b(flow|execution)\b/.test(t) && /\b(stop|abort)\b/.test(t)) {
      if (typeof FlowExecutor !== 'undefined') FlowExecutor.stop();
      return;
    }

    /* ── Sim path tools (not flow blocks) ── */
    if (t.includes('follow path')) {
      if (window.SimRobot3D?.followDrawnPath?.()) showToast('Following drawn path', 'success');
      else showToast('Draw a path first', 'warning');
      return;
    }
    if (t.includes('clear path')) return window.SimRobot3D?.clearDrawnPath?.();
    if (t.includes('draw path')) return window.SimRobot3D?.setPathDrawMode?.(true);

    /* ── Cargo (pickup:any / drop:here for generic phrases) ── */
    if (t.includes('pick') && t.includes('cargo')) {
      const id = toCargoId(t);
      const payload = id ? `pickup:${id}` : 'pickup:any';
      return ROS.publishString('/cargo_command', payload);
    }
    if (t.includes('drop') && t.includes('cargo')) {
      const id = toCargoId(t);
      const payload = id ? `drop:${id}` : 'drop:here';
      return ROS.publishString('/cargo_command', payload);
    }

    /* ── Motion blocks ── */
    if (t.includes('move') && t.includes('forward')) return void runFlowBlock('move_forward');
    if (t.includes('move') && t.includes('backward')) return void runFlowBlock('move_backward');
    if (wantsRotateLeftPhrase(t) || (t === 'left' && !t.includes('flow'))) return void rotateVoiceLeft();
    if (wantsRotateRightPhrase(t) || (t === 'right' && !t.includes('flow'))) return void rotateVoiceRight();
    if (t.includes('forward') || t.includes('drive forward')) return void runFlowBlock('move_forward');
    if ((t.includes('back') || t.includes('reverse')) && !t.includes('feedback')) return void runFlowBlock('move_backward');
    if (/\bset\s+speed\b/.test(t)) return void runFlowBlock('set_speed');

    /* ── Navigation blocks (set home before “go home” / waypoint) ── */
    if (/\b(set|save)\b/.test(t) && /\bhome\b/.test(t)) return void runFlowBlock('set_home');
    if (/\b(return\s+home|go\s+home)\b/.test(t) || /^home$/.test(t.trim())) return void runFlowBlock('return_home');
    if (/\b(waypoint|navigate|go\s+to)\b/.test(t)) {
      const xy = parseTwoFloats(t);
      if (xy) {
        const heading = parseFirstHeadingDeg(t);
        return void runFlowBlock('navigate_to_pose', {
          x: xy.x,
          y: xy.y,
          heading: heading != null ? heading : 0,
          wait_done: true,
        });
      }
      return void runFlowBlock('navigate_to_pose');
    }

    /* ── AGV blocks ── */
    if (/\bdock\b/.test(t) && !t.includes('undock')) {
      return void runFlowBlock('dock', { station_id: parseStationId(t) });
    }
    if (t.includes('undock')) return void runFlowBlock('undock');
    if (t.includes('wait') && t.includes('station')) {
      const sec = parseWaitSeconds(t);
      return void runFlowBlock('wait_station', { wait_time: sec != null ? sec : 5 });
    }
    if (t.includes('charge') || t.includes('charging')) return void runFlowBlock('charge');

    /* ── Control / sensing blocks ── */
    if (/\b(wait|delay|pause)\b/.test(t) && (t.includes('second') || /\d/.test(t))) {
      const sec = parseWaitSeconds(t);
      if (sec != null) return void runFlowBlock('wait', { duration: sec });
    }
    if (t.includes('emit') || t.includes('event')) {
      const m = t.match(/event\s+([\w-]+)/);
      return void runFlowBlock('emit_event', { event_name: m ? m[1] : 'task_done' });
    }
    if (t.includes('battery')) return void runFlowBlock('check_battery');
    if (t.includes('obstacle') || t.includes('scan')) return void runFlowBlock('detect_obstacle');
    if (t.includes('position') || t.includes('odom') || t.includes('where am i')) return void runFlowBlock('read_position');

    /* ── Fallback: stop / estop ── */
    if (/\b(halt|estop|e-stop)\b/.test(t) || /^stop$/.test(t.trim()) || t.includes('stop robot')) {
      return void runFlowBlock('stop');
    }
  }

  async function handleCommand(raw) {
    const text = String(raw || '').trim();
    if (!text) return;

    const conversational = useSpeakReplies() && useAnyLlm();

    if (useLlmBackend()) {
      try {
        ROS.simLog(`🎤 Voice → LLM (backend): "${text}"`);
        if (conversational) {
          const { reply, commands } = await chatWithBackend(text);
          commands.forEach(c => executeParsedCommand(c));
          if (reply) {
            ROS.simLog(`🤖 ${reply}`);
            speakReply(reply);
          }
          if (!reply && !commands.length) showToast('LLM: empty reply', 'info');
          else if (commands.length) showToast(commands.join(' · '), 'success');
        } else {
          const cmds = await parseWithBackend(text);
          if (!cmds.length) {
            showToast('LLM: no robot command', 'info');
            return;
          }
          cmds.forEach(c => executeParsedCommand(c));
          showToast(`LLM: ${cmds.join(' · ')}`, 'success');
        }
      } catch (e) {
        console.warn(e);
        showToast(`LLM failed: ${e.message}`, 'error');
        handleCommandLocal(text);
      }
      return;
    }

    if (useLlmDirect()) {
      const { key, base, model } = getOpenaiDirect();
      if (!key) {
        showToast('Add API key for direct LLM or disable it', 'warning');
        handleCommandLocal(text);
        return;
      }
      try {
        ROS.simLog(`🎤 Voice → LLM (direct): "${text}"`);
        if (conversational) {
          const { reply, commands } = await chatWithOpenaiCompatible(text, key, base, model);
          commands.forEach(c => executeParsedCommand(c));
          if (reply) {
            ROS.simLog(`🤖 ${reply}`);
            speakReply(reply);
          }
          if (!reply && !commands.length) showToast('LLM: empty reply', 'info');
          else if (commands.length) showToast(commands.join(' · '), 'success');
        } else {
          const cmds = await parseWithOpenaiCompatible(text, key, base, model);
          if (!cmds.length) {
            showToast('LLM: no robot command', 'info');
            return;
          }
          cmds.forEach(c => executeParsedCommand(c));
          showToast(`LLM: ${cmds.join(' · ')}`, 'success');
        }
      } catch (e) {
        console.warn(e);
        showToast(`LLM/CORS error — use backend proxy or local OpenAI base: ${e.message}`, 'error');
        handleCommandLocal(text);
      }
      return;
    }

    if (useSpeakReplies()) {
      showToast('Turn on backend or direct LLM for AI voice replies', 'info');
    }

    handleCommandLocal(text);
  }

  function syncButtons() {
    document.querySelectorAll('.js-voice-toggle').forEach(btn => {
      btn.classList.toggle('active', voiceArmed);
      if (!voiceArmed) btn.textContent = 'Voice';
      else if (listening) btn.textContent = 'Listening…';
      else btn.textContent = 'Voice On';
    });
  }

  function start() {
    if (!recognition) return showToast('Voice recognition unavailable in this browser', 'warning');
    voiceArmed = true;
    recognition.start();
  }

  function stop() {
    if (!recognition) return;
    voiceArmed = false;
    pauseMicForTts = false;
    window.speechSynthesis?.cancel();
    recognition.stop();
  }

  function toggle() {
    if (voiceArmed && listening) stop();
    else start();
  }

  function init() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return;
    recognition = new SR();
    recognition.lang = 'en-US';
    recognition.continuous = true;
    recognition.interimResults = false;

    recognition.onstart = () => {
      listening = true;
      syncButtons();
      showToast('Voice control listening…', 'info');
    };
    recognition.onend = () => {
      listening = false;
      if (!pauseMicForTts && voiceArmed) {
        try {
          recognition.start();
        } catch (_) {}
      }
      syncButtons();
    };
    recognition.onresult = e => {
      const r = e.results[e.results.length - 1];
      if (r?.isFinal) handleCommand(r[0].transcript);
    };
    recognition.onerror = () => {
      listening = false;
      syncButtons();
    };
    syncButtons();
  }

  return { init, toggle, handleCommand, handleCommandLocal, executeParsedCommand, speakReply };
})();
