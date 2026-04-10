/**
 * RoboFlow — Flow Executor
 * Traverses the node graph and executes each block sequentially.
 * Supports Loop Start / Loop End cycles.
 */
const FlowExecutor = (() => {

  /* ── State ─────────────────────────────────────────────── */
  let running      = false;
  let paused       = false;
  let stopRequested = false;
  let loopCounters = new Map();  // blockId → { current, max }
  let currentBlockId = null;
  const MAX_STEPS = 5000;

  /* ── UI helpers ─────────────────────────────────────────── */
  function setStatus(text, cls = '') {
    const el = document.getElementById('exec-status-text');
    const log = document.getElementById('execution-log');
    if (el) el.textContent = text;
    if (log) {
      log.className = 'exec-log' + (cls ? ' ' + cls : '');
    }
    ROS.simLog(text);
  }

  function setStepBadge(text) {
    const b = document.getElementById('exec-step-badge');
    if (!b) return;
    if (text) { b.textContent = text; b.classList.remove('hidden'); }
    else       { b.classList.add('hidden'); }
  }

  function setButtonStates(isRunning) {
    const btnRun   = document.getElementById('btn-run');
    const btnPause = document.getElementById('btn-pause');
    const btnStop  = document.getElementById('btn-stop-exec');
    if (btnRun)   btnRun.disabled   = isRunning;
    if (btnPause) btnPause.disabled  = !isRunning;
    if (btnStop)  btnStop.disabled   = !isRunning;
  }

  /* ── Wait for un-pause ──────────────────────────────────── */
  function waitForUnpause() {
    return new Promise(resolve => {
      const interval = setInterval(() => {
        if (!paused || stopRequested) { clearInterval(interval); resolve(); }
      }, 100);
    });
  }

  /* ── Main run ───────────────────────────────────────────── */
  async function run() {
    if (running) return;

    // Validate: find START block
    const startBlock = FlowEngine.findBlockByType('start');
    if (!startBlock) {
      showToast('Add a START block to begin!', 'warning');
      return;
    }

    running       = true;
    paused        = false;
    stopRequested = false;
    loopCounters  = new Map();

    setButtonStates(true);
    setStatus('▶ Starting flow…', 'running');

    // Highlight start
    FlowEngine.setBlockExecuting(startBlock.id, true);

    let currentId = startBlock.id;
    let steps     = 0;

    try {
      while (currentId && !stopRequested && steps < MAX_STEPS) {
        steps++;

        if (paused) {
          setStatus('⏸ Paused', 'paused');
          await waitForUnpause();
          if (stopRequested) break;
          setStatus('▶ Resuming…', 'running');
        }

        const block = FlowEngine.getBlock(currentId);
        if (!block) break;

        const def   = FlowBlocks.get(block.type);
        if (!def)   { currentId = getNext(currentId, 0); continue; }

        // ── Highlight current block ──
        if (currentBlockId) FlowEngine.setBlockExecuting(currentBlockId, false);
        currentBlockId = currentId;
        FlowEngine.setBlockExecuting(currentId, true);
        setStepBadge(`Step ${steps}`);

        // ── END block → finish ──
        if (block.type === 'end') {
          await def.execute(block.params || {});
          break;
        }

        // ── LOOP START (two inputs: enter ← START/prior, repeat ← Loop End) ──
        if (block.type === 'loop_start') {
          if (!loopCounters.has(currentId)) {
            const max = parseInt(block.params?.iterations || def.params[0].default, 10);
            loopCounters.set(currentId, { current: 0, max });
          }
          const counter = loopCounters.get(currentId);
          counter.current++;
          setStatus(`🔄 Loop ${counter.current}/${counter.max}`, 'running');

          if (counter.current <= counter.max) {
            // Follow "body" output (port 0)
            currentId = getNext(currentId, 0);
          } else {
            // Loop exhausted → follow "exit" output (port 1)
            loopCounters.delete(currentId);
            currentId = getNext(currentId, 1);
          }
          continue;
        }

        // ── LOOP END — wire output → Loop Start “repeat” input (input port 1) ──
        if (block.type === 'loop_end') {
          currentId = getNext(currentId, 0);
          continue;
        }

        // ── Regular block ──
        setStatus(`⚙ Executing: ${def.label}`, 'running');
        try {
          await def.execute(block.params || {});
        } catch (err) {
          setStatus(`⚠ Error in "${def.label}": ${err.message}`, 'error');
          showToast(`Block error: ${err.message}`, 'error');
          break;
        }

        if (stopRequested) break;

        currentId = getNext(currentId, 0);
      }

      if (steps >= MAX_STEPS) {
        setStatus('⚠ Max steps reached — possible infinite loop', 'error');
        showToast('Execution stopped: max steps reached', 'warning');
      } else if (!stopRequested) {
        setStatus('✅ Flow complete!', 'done');
        showToast('Flow executed successfully!', 'success');
      } else {
        setStatus('⏹ Stopped', '');
      }
    } catch (err) {
      setStatus(`⚠ Unexpected error: ${err.message}`, 'error');
    } finally {
      running = false;
      paused  = false;
      if (currentBlockId) FlowEngine.setBlockExecuting(currentBlockId, false);
      currentBlockId = null;
      setButtonStates(false);
      setStepBadge('');
      FlowEngine.clearAllExecuting();
    }
  }

  /* ── Get next block ID from a given output port ─────────── */
  function getNext(blockId, portIndex = 0) {
    const conn = FlowEngine.getConnections().find(
      c => c.sourceId === blockId && c.sourcePort === portIndex
    );
    return conn ? conn.targetId : null;
  }

  /* ── Pause / Resume ─────────────────────────────────────── */
  function pause() {
    if (!running) return;
    paused = !paused;
    const btn = document.getElementById('btn-pause');
    if (btn) btn.textContent = paused ? '▶ Resume' : '⏸ Pause';
    if (!paused) setStatus('▶ Resumed', 'running');
  }

  /* ── Stop ───────────────────────────────────────────────── */
  function stop() {
    stopRequested = true;
    paused        = false;
    ROS.stop();
  }

  /* ── Public ─────────────────────────────────────────────── */
  return { run, pause, stop };
})();
