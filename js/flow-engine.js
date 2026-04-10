/**
 * RoboFlow — Flow Engine
 * Handles the drag-and-drop canvas, block nodes, SVG connections,
 * pan/zoom, and block properties panel.
 */
const FlowEngine = (() => {

  /* ════════════════════════════════════════
     STATE
  ════════════════════════════════════════ */
  let blocks = new Map();   // id → { id, type, x, y, params }
  let connections = new Map();   // id → { id, sourceId, sourcePort, targetId, targetPort }
  let selectedId = null;
  let nextId = 1;

  // Pan / zoom
  let panX = 0;
  let panY = 0;
  let zoom = 1;
  const MIN_ZOOM = 0.2;
  const MAX_ZOOM = 2.5;

  // Drag state machine
  let drag = null;
  /*  drag types:
      { type:'pan',     startX, startY, origPanX, origPanY }
      { type:'block',   id, startX, startY, origX, origY }
      { type:'connect', sourceId, sourcePort }
  */

  // Pending palette drop
  let pendingDropType = null;

  /* ════════════════════════════════════════
     DOM REFS
  ════════════════════════════════════════ */
  let container, viewport, canvasEl, svgEl, connGroup, previewPath;

  /* ════════════════════════════════════════
     INIT
  ════════════════════════════════════════ */
  function init() {
    container = document.getElementById('canvas-container');
    viewport = document.getElementById('canvas-viewport');
    canvasEl = document.getElementById('canvas-el');
    svgEl = document.getElementById('connections-svg');
    connGroup = document.getElementById('connections-group');
    previewPath = document.getElementById('preview-connection');

    buildPalette();
    bindPaletteSearch();
    bindCanvasEvents();
    bindZoomControls();

    // Default pan: offset to show canvas content nicely
    panX = 100;
    panY = 100;
    zoom = 1;
    applyViewport();

    // Start with START and END blocks well-spaced apart
    addBlock('start', 60,  100);
    addBlock('end',   480, 100);

    renderAll();
    showToast('Welcome to RoboFlow! Drag blocks from the left to build your robot program.', 'info', 5000);
  }

  /* ════════════════════════════════════════
     PALETTE
  ════════════════════════════════════════ */
  function buildPalette(filter = '') {
    const container = document.getElementById('palette-categories');
    if (!container) return;
    container.innerHTML = '';

    FlowBlocks.getCategories().forEach(cat => {
      const blocks = FlowBlocks.getAll().filter(b =>
        b.category === cat.id &&
        (filter === '' ||
          b.label.toLowerCase().includes(filter.toLowerCase()) ||
          b.category.toLowerCase().includes(filter.toLowerCase()))
      );
      if (blocks.length === 0) return;

      const section = document.createElement('div');
      section.className = 'palette-category';

      const header = document.createElement('div');
      header.className = 'palette-cat-header';
      header.innerHTML = `<span class="cat-dot" style="background:${cat.color}"></span>${cat.label}`;
      header.addEventListener('click', () => section.classList.toggle('collapsed'));
      section.appendChild(header);

      const list = document.createElement('div');
      list.className = 'palette-block-list';
      blocks.forEach(def => {
        const item = createPaletteItem(def);
        list.appendChild(item);
      });
      section.appendChild(list);
      container.appendChild(section);
    });
  }

  function createPaletteItem(def) {
    const item = document.createElement('div');
    item.className = 'palette-block-item';
    item.setAttribute('draggable', 'true');
    item.setAttribute('data-block-type', def.id);
    item.setAttribute('role', 'button');
    item.setAttribute('tabindex', '0');
    item.setAttribute('aria-label', `Add ${def.label} block`);
    item.title = `Drag to canvas to add: ${def.label}`;
    item.innerHTML = `
      <span class="palette-item-icon" style="color:${def.color}">${def.icon}</span>
      <span class="palette-item-label">${def.label}</span>
      <span class="palette-item-ports">
        ${def.inputs > 0 ? `<span class="port-badge in">${def.inputs}in</span>` : ''}
        ${def.outputs > 0 ? `<span class="port-badge out">${def.outputs}out</span>` : ''}
      </span>`;
    item.addEventListener('dragstart', e => {
      pendingDropType = def.id;
      e.dataTransfer.effectAllowed = 'copy';
      e.dataTransfer.setData('text/plain', def.id);
    });
    return item;
  }

  function bindPaletteSearch() {
    const input = document.getElementById('palette-search');
    if (!input) return;
    input.addEventListener('input', () => buildPalette(input.value));
  }

  /* ════════════════════════════════════════
     CANVAS EVENTS
  ════════════════════════════════════════ */
  function bindCanvasEvents() {
    // Drop from palette
    container.addEventListener('dragover', e => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
    container.addEventListener('drop', onCanvasDrop);

    // SINGLE delegated mousedown for the whole canvas
    container.addEventListener('mousedown', onCanvasMouseDown);

    // Scroll → zoom
    container.addEventListener('wheel', e => {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.1 : 0.9;
      const rect = container.getBoundingClientRect();
      zoomAt(factor, e.clientX - rect.left, e.clientY - rect.top);
    }, { passive: false });

    // Global mouse move & up
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup',   onMouseUp);

    // Right-click on canvas to deselect
    container.addEventListener('contextmenu', e => e.preventDefault());

    // Keyboard shortcuts
    document.addEventListener('keydown', onKeyDown);
  }

  function onCanvasMouseDown(e) {
    if (e.button !== 0) return; // left button only

    const rect = container.getBoundingClientRect();
    const cx = (e.clientX - rect.left - panX) / zoom;
    const cy = (e.clientY - rect.top  - panY) / zoom;

    // ── 1. OUTPUT port: prefer real DOM hit (matches flex layout; avoids bogus coord math) ──
    const outPortEl = e.target.closest('.port-output');
    if (outPortEl) {
      e.preventDefault();
      e.stopPropagation();
      const bid = outPortEl.getAttribute('data-block-id');
      const pIdx = parseInt(outPortEl.getAttribute('data-port-index'), 10) || 0;
      startConnection(bid, pIdx);
      return;
    }
    // Fallback: coordinate hit (extended ::before zone quirks / edge cases)
    const outPort = findNearestOutputPort(cx, cy, 28);
    if (outPort) {
      e.preventDefault();
      e.stopPropagation();
      startConnection(outPort.blockId, outPort.portIndex);
      return;
    }

    // ── 2. Check if clicked on a DELETE button ──
    const delBtn = e.target.closest('[data-delete-id]');
    if (delBtn) {
      e.stopPropagation();
      deleteBlock(delBtn.getAttribute('data-delete-id'));
      renderAll();
      return;
    }

    // ── 3. Check if clicked on a block header (drag block) ──
    const blockEl = e.target.closest('.block-node');
    if (blockEl) {
      const bid = blockEl.getAttribute('data-block-id');
      const block = blocks.get(bid);
      if (block) {
        selectBlock(bid);
        drag = {
          type: 'block',
          id:   bid,
          startX: e.clientX, startY: e.clientY,
          origX: block.x,    origY: block.y,
        };
        e.stopPropagation();
        return;
      }
    }

    // ── 4. Pan (background click) ──
    selectBlock(null);
    drag = {
      type: 'pan',
      startX: e.clientX, startY: e.clientY,
      origPanX: panX,    origPanY: panY,
    };
    container.classList.add('is-panning');
    e.preventDefault();
  }

  function onCanvasDrop(e) {
    e.preventDefault();
    const type = e.dataTransfer.getData('text/plain') || pendingDropType;
    pendingDropType = null;
    if (!type) return;
    const rect = container.getBoundingClientRect();
    const cx = (e.clientX - rect.left - panX) / zoom;
    const cy = (e.clientY - rect.top - panY) / zoom;
    const id = addBlock(type, cx - FlowBlocks.BLOCK_W / 2, cy - 20);
    selectBlock(id);
    renderAll();
  }

  function onMouseMove(e) {
    if (!drag) return;

    if (drag.type === 'pan') {
      panX = drag.origPanX + (e.clientX - drag.startX);
      panY = drag.origPanY + (e.clientY - drag.startY);
      applyViewport();
    }

    if (drag.type === 'block') {
      const dx = (e.clientX - drag.startX) / zoom;
      const dy = (e.clientY - drag.startY) / zoom;
      const block = blocks.get(drag.id);
      if (block) {
        block.x = drag.origX + dx;
        block.y = drag.origY + dy;
        // Move DOM node
        const el = document.getElementById(`block-${drag.id}`);
        if (el) { el.style.left = block.x + 'px'; el.style.top = block.y + 'px'; }
        // Redraw only connections
        renderConnections();
      }
    }

    if (drag.type === 'connect') {
      const rect = container.getBoundingClientRect();
      const cx = (e.clientX - rect.left - panX) / zoom;
      const cy = (e.clientY - rect.top  - panY) / zoom;
      const src = getPortPos(drag.sourceId, 'output', drag.sourcePort);
      if (src) drawPreview(src.x, src.y, cx, cy);

      // Highlight nearest input port as snap-to target
      document.querySelectorAll('.port-input.port-hover')
        .forEach(p => p.classList.remove('port-hover'));
      const nearest = findNearestInputPort(cx, cy, 60); // 60px snap radius
      if (nearest) {
        const portEl = document.querySelector(
          `[data-block-id="${nearest.blockId}"][data-port-type="input"][data-port-index="${nearest.portIndex}"]`
        );
        if (portEl) portEl.classList.add('port-hover');
      }
    }
  }

  function onMouseUp(e) {
    if (!drag) return;

    if (drag.type === 'pan') {
      container.classList.remove('is-panning');
    }

    if (drag.type === 'connect') {
      previewPath.setAttribute('opacity', '0');
      container.classList.remove('is-connecting');
      document.querySelectorAll('.port-input.port-hover')
        .forEach(p => p.classList.remove('port-hover'));

      const under = document.elementFromPoint(e.clientX, e.clientY);
      const portEl = under ? under.closest('[data-port-type="input"]') : null;

      if (portEl) {
        const tid   = portEl.getAttribute('data-block-id');
        const tPort = parseInt(portEl.getAttribute('data-port-index'), 10) || 0;
        finishConnection(drag.sourceId, drag.sourcePort, tid, tPort);
      } else {
        const rect    = container.getBoundingClientRect();
        const cx      = (e.clientX - rect.left - panX) / zoom;
        const cy      = (e.clientY - rect.top  - panY) / zoom;
        const nearest = findNearestInputPort(cx, cy, 56);
        if (nearest && nearest.blockId !== drag.sourceId) {
          finishConnection(drag.sourceId, drag.sourcePort, nearest.blockId, nearest.portIndex);
        }
      }
    }

    drag = null;
  }

  function onKeyDown(e) {
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (selectedId) deleteBlock(selectedId);
    }
    if (e.key === '+' || e.key === '=') zoomAt(1.1, window.innerWidth / 2, window.innerHeight / 2);
    if (e.key === '-') zoomAt(0.9, window.innerWidth / 2, window.innerHeight / 2);
    if (e.key === 'f' || e.key === 'F') zoomFit();
    if (e.key === 'F5') { e.preventDefault(); FlowExecutor.run(); }
    if (e.key === 'Escape') { FlowExecutor.stop(); }
  }

  /* ════════════════════════════════════════
     ZOOM / PAN
  ════════════════════════════════════════ */
  function applyViewport() {
    viewport.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`;
    const label = document.getElementById('zoom-label');
    if (label) label.textContent = Math.round(zoom * 100) + '%';
  }

  function zoomAt(factor, cx, cy) {
    const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom * factor));
    if (newZoom === zoom) return;
    panX = cx - (cx - panX) * (newZoom / zoom);
    panY = cy - (cy - panY) * (newZoom / zoom);
    zoom = newZoom;
    applyViewport();
  }

  function bindZoomControls() {
    const rect = () => container.getBoundingClientRect();
    document.getElementById('btn-zoom-in')?.addEventListener('click', () =>
      zoomAt(1.2, rect().left + rect().width / 2, rect().top + rect().height / 2));
    document.getElementById('btn-zoom-out')?.addEventListener('click', () =>
      zoomAt(0.8, rect().left + rect().width / 2, rect().top + rect().height / 2));
    document.getElementById('btn-zoom-fit')?.addEventListener('click', zoomFit);
  }

  function zoomFit() {
    if (blocks.size === 0) return;
    const rect = container.getBoundingClientRect();
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    blocks.forEach(b => {
      const def = FlowBlocks.get(b.type);
      const h = FlowBlocks.getBlockHeight(def);
      const w = FlowBlocks.BLOCK_W;
      minX = Math.min(minX, b.x);
      minY = Math.min(minY, b.y);
      maxX = Math.max(maxX, b.x + w);
      maxY = Math.max(maxY, b.y + h);
    });
    const pad = 80;
    const fw = rect.width - pad * 2;
    const fh = rect.height - pad * 2;
    const dw = maxX - minX;
    const dh = maxY - minY;
    const newZ = Math.min(fw / dw, fh / dh, MAX_ZOOM);
    zoom = Math.max(MIN_ZOOM, newZ);
    panX = pad - minX * zoom;
    panY = pad - minY * zoom;
    applyViewport();
  }

  /* ════════════════════════════════════════
     BLOCK CRUD
  ════════════════════════════════════════ */
  function addBlock(type, x, y) {
    const def = FlowBlocks.get(type);
    if (!def) return null;
    const id = 'b' + (nextId++);
    const params = {};
    (def.params || []).forEach(p => { params[p.name] = p.default; });
    blocks.set(id, { id, type, x, y, params });
    return id;
  }

  function deleteBlock(id) {
    const block = blocks.get(id);
    if (!block) return;
    const def = FlowBlocks.get(block.type);
    if (def && def.fixed) { showToast('The START and END blocks cannot be deleted.', 'warning'); return; }

    // Remove connected connections
    connections.forEach((c, cid) => {
      if (c.sourceId === id || c.targetId === id) connections.delete(cid);
    });
    blocks.delete(id);

    if (selectedId === id) { selectedId = null; showPropertiesEmpty(); }
    renderAll();
  }

  function findBlockByType(type) {
    for (const b of blocks.values()) { if (b.type === type) return b; }
    return null;
  }

  function getBlock(id) { return blocks.get(id); }
  function getConnections() { return [...connections.values()]; }

  /* ════════════════════════════════════════
     SELECTION
  ════════════════════════════════════════ */
  function selectBlock(id) {
    if (selectedId) {
      const prev = document.getElementById(`block-${selectedId}`);
      if (prev) prev.classList.remove('selected');
    }
    selectedId = id;
    if (id) {
      const el = document.getElementById(`block-${id}`);
      if (el) el.classList.add('selected');
      showProperties(id);
    } else {
      showPropertiesEmpty();
    }
  }

  /* ════════════════════════════════════════
     CONNECTIONS
  ════════════════════════════════════════ */
  function startConnection(sourceId, sourcePort) {
    drag = { type: 'connect', sourceId, sourcePort };
    container.classList.add('is-connecting');
  }

  function finishConnection(sourceId, sourcePort, targetId, targetPort) {
    if (sourceId === targetId) return;
    // Prevent duplicate connections from same source port
    for (const c of connections.values()) {
      if (c.sourceId === sourceId && c.sourcePort === sourcePort) {
        connections.delete(c.id);
        break;
      }
    }
    // Prevent duplicate connections to same target port
    for (const c of connections.values()) {
      if (c.targetId === targetId && c.targetPort === targetPort) {
        connections.delete(c.id);
        break;
      }
    }
    const id = 'c' + (nextId++);
    connections.set(id, { id, sourceId, sourcePort, targetId, targetPort });
    renderConnections();
  }

  function deleteConnection(id) {
    connections.delete(id);
    renderConnections();
  }

  /**
   * findNearestInputPort — coordinate-based connection detection.
   * Returns { blockId, portIndex, dist } for the nearest input port
   * within maxDist canvas-coordinate pixels, or null.
   */
  function findNearestInputPort(cx, cy, maxDist) {
    let best = null;
    blocks.forEach((block, blockId) => {
      const def = FlowBlocks.get(block.type);
      if (!def || def.inputs === 0) return;
      const nIn = def.inputs;
      for (let pi = 0; pi < nIn; pi++) {
        const pos = getPortPos(blockId, 'input', pi);
        if (!pos) continue;
        const dist = Math.hypot(cx - pos.x, cy - pos.y);
        if (dist <= maxDist && (!best || dist < best.dist)) {
          best = { blockId, portIndex: pi, dist };
        }
      }
    });
    return best;
  }

  /** findNearestOutputPort — finds the closest output port to canvas coords (cx, cy) */
  function findNearestOutputPort(cx, cy, maxDist) {
    let best = null;
    blocks.forEach((block, blockId) => {
      const def = FlowBlocks.get(block.type);
      if (!def || def.outputs === 0) return;
      for (let i = 0; i < def.outputs; i++) {
        const pos = getPortPos(blockId, 'output', i);
        if (!pos) continue;
        const dist = Math.hypot(cx - pos.x, cy - pos.y);
        if (dist <= maxDist && (!best || dist < best.dist)) {
          best = { blockId, portIndex: i, dist };
        }
      }
    });
    return best;
  }

  /* ════════════════════════════════════════
     PORT POSITIONS (canvas coordinates)
  ════════════════════════════════════════ */
  function getPortPos(blockId, portType, portIndex) {
    const block = blocks.get(blockId);
    if (!block) return null;
    const def = FlowBlocks.get(block.type);
    if (!def) return null;
    const h = FlowBlocks.getBlockHeight(def);
    const w = FlowBlocks.BLOCK_W;

    const el = document.getElementById(`block-${blockId}`);
    if (el && container) {
      let portEl = null;
      if (portType === 'input' && def.inputs > 0) {
        if (def.inputs === 1) {
          portEl = el.querySelector('.port-input');
        } else {
          const ins = el.querySelectorAll('.block-input-ports .port-input');
          portEl = ins[portIndex] || null;
        }
      } else if (portType === 'output' && def.outputs > 0) {
        const outs = el.querySelectorAll('.port-output');
        portEl = outs[portIndex] || null;
      }
      if (portEl) {
        const pr = portEl.getBoundingClientRect();
        const cr = container.getBoundingClientRect();
        return {
          x: (pr.left + pr.width / 2 - cr.left - panX) / zoom,
          y: (pr.top + pr.height / 2 - cr.top - panY) / zoom,
        };
      }
    }

    // Fallback when DOM not ready (rare)
    if (portType === 'input') {
      const nIn = def.inputs || 1;
      const t = nIn === 1 ? 0.5 : (portIndex + 1) / (nIn + 1);
      return { x: block.x, y: block.y + t * h };
    }
    if (portType === 'output') {
      const totalOuts = def.outputs || 1;
      const yMid = block.y + h / 2;
      if (totalOuts === 1) {
        return { x: block.x + w, y: yMid };
      }
      const t = (portIndex + 1) / (totalOuts + 1);
      return { x: block.x + w, y: block.y + t * h };
    }
    return null;
  }

  /* ════════════════════════════════════════
     SVG HELPERS
  ════════════════════════════════════════ */
  function bezierPath(x1, y1, x2, y2) {
    const cx = Math.abs(x2 - x1) * 0.5 + 40;
    return `M ${x1},${y1} C ${x1 + cx},${y1} ${x2 - cx},${y2} ${x2},${y2}`;
  }

  function drawPreview(x1, y1, x2, y2) {
    previewPath.setAttribute('d', bezierPath(x1, y1, x2, y2));
    previewPath.setAttribute('opacity', '1');
  }

  /* ════════════════════════════════════════
     RENDER — BLOCKS
  ════════════════════════════════════════ */
  function renderBlocks() {
    /* Full rebuild so block defs can change (e.g. Loop Start gaining a second input). */
    canvasEl.innerHTML = '';
    blocks.forEach(block => {
      const el = createBlockEl(block);
      canvasEl.appendChild(el);
    });
  }

  function createBlockEl(block) {
    const def = FlowBlocks.get(block.type);
    if (!def) return document.createElement('div');
    const h = FlowBlocks.getBlockHeight(def);
    const w = FlowBlocks.BLOCK_W;

    const el = document.createElement('div');
    el.id = `block-${block.id}`;
    el.className = `block-node cat-${def.category}`;
    el.style.cssText = `left:${block.x}px;top:${block.y}px;width:${w}px;`;
    el.setAttribute('data-block-id', block.id);
    el.setAttribute('data-block-type', block.type);

    // ── Input port(s) ──
    if (def.inputs > 0) {
      if (def.inputs === 1) {
        const port = document.createElement('div');
        port.className = 'block-port port-input';
        port.setAttribute('data-port-type', 'input');
        port.setAttribute('data-block-id', block.id);
        port.setAttribute('data-port-index', '0');
        port.title = 'Input';
        el.appendChild(port);
      } else {
        const wrap = document.createElement('div');
        wrap.className = 'block-input-ports';
        for (let i = 0; i < def.inputs; i++) {
          const port = document.createElement('div');
          port.className = 'block-port port-input';
          port.setAttribute('data-port-type', 'input');
          port.setAttribute('data-block-id', block.id);
          port.setAttribute('data-port-index', String(i));
          const inLab = def.inputLabels?.[i];
          port.title = inLab || `Input ${i}`;
          if (inLab) {
            const lbl = document.createElement('span');
            lbl.className = 'port-label port-label-in';
            lbl.textContent = inLab;
            port.appendChild(lbl);
          }
          wrap.appendChild(port);
        }
        el.appendChild(wrap);
      }
    }

    // ── Header ──
    const hdr = document.createElement('div');
    hdr.className = 'block-header';
    hdr.style.background = def.color;
    hdr.innerHTML = `
      <span class="block-icon">${def.icon}</span>
      <span class="block-label">${def.label}</span>
      ${!def.fixed ? `<button class="block-delete-btn" data-delete-id="${block.id}" title="Delete block">✕</button>` : ''}
    `;
    el.appendChild(hdr);

    // ── Output ports ──
    if (def.outputs > 0) {
      const portsEl = document.createElement('div');
      portsEl.className = 'block-output-ports';
      for (let i = 0; i < def.outputs; i++) {
        const port = document.createElement('div');
        port.className = 'block-port port-output';
        port.setAttribute('data-port-type', 'output');
        port.setAttribute('data-block-id', block.id);
        port.setAttribute('data-port-index', String(i));
        const label = def.outputLabels?.[i] || (def.outputs > 1 ? `out ${i}` : '');
        if (label) port.setAttribute('title', label);
        if (label) {
          const lbl = document.createElement('span');
          lbl.className = 'port-label';
          lbl.textContent = label;
          port.appendChild(lbl);
        }
        portsEl.appendChild(port);
      }
      el.appendChild(portsEl);
    }

    // ── Body (params summary) ──
    if (def.params && def.params.length > 0) {
      const body = document.createElement('div');
      body.className = 'block-body';
      body.innerHTML = def.params.map(p => {
        const val = block.params[p.name] ?? p.default;
        return `<div class="block-param-row">
          <span class="param-name">${p.label}</span>
          <span class="param-value">${formatParamVal(p, val)}</span>
        </div>`;
      }).join('');
      el.appendChild(body);
    }


    /* ── Events now handled centrally via onCanvasMouseDown ── */
    /* (block drag, port start, delete) */

    // Delete button — keep click handler for the ✕ button
    el.querySelectorAll('.block-delete-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        deleteBlock(btn.getAttribute('data-delete-id'));
        renderAll();
      });
    });

    // Right-click → delete block
    el.addEventListener('contextmenu', e => {
      e.preventDefault();
      e.stopPropagation();
      deleteBlock(block.id);
      renderAll();
    });

    return el;
  }

  function formatParamVal(param, val) {
    if (param.type === 'toggle') return val ? 'Yes' : 'No';
    if (param.type === 'slider' || param.type === 'number') return `${val} ${param.unit || ''}`;
    return String(val);
  }

  /* ════════════════════════════════════════
     RENDER — CONNECTIONS
  ════════════════════════════════════════ */
  function renderConnections() {
    connGroup.innerHTML = '';
    connections.forEach(conn => {
      const src = getPortPos(conn.sourceId, 'output', conn.sourcePort ?? 0);
      const tgt = getPortPos(conn.targetId, 'input', conn.targetPort ?? 0);
      if (!src || !tgt) return;

      const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      g.setAttribute('data-conn-id', conn.id);
      g.style.cursor = 'pointer';

      // Invisible wide hit path
      const hit = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      hit.setAttribute('d', bezierPath(src.x, src.y, tgt.x, tgt.y));
      hit.setAttribute('fill', 'none');
      hit.setAttribute('stroke', 'transparent');
      hit.setAttribute('stroke-width', '16');
      hit.style.pointerEvents = 'stroke';
      g.appendChild(hit);

      // Visible path
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', bezierPath(src.x, src.y, tgt.x, tgt.y));
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke', '#344d66');
      path.setAttribute('stroke-width', '2');
      path.setAttribute('marker-end', 'url(#arrow-default)');
      path.style.pointerEvents = 'none';
      g.appendChild(path);

      // Click to delete
      g.addEventListener('click', () => {
        deleteConnection(conn.id);
      });
      g.addEventListener('mouseenter', () => path.setAttribute('stroke', '#00d4ff'));
      g.addEventListener('mouseleave', () => path.setAttribute('stroke', '#344d66'));

      connGroup.appendChild(g);
    });
  }

  /* ════════════════════════════════════════
     RENDER — ALL
  ════════════════════════════════════════ */
  function renderAll() {
    renderBlocks();
    renderConnections();
    if (selectedId) selectBlock(selectedId);
  }

  /* ════════════════════════════════════════
     PROPERTIES PANEL
  ════════════════════════════════════════ */
  function showPropertiesEmpty() {
    const title = document.getElementById('properties-title');
    const content = document.getElementById('properties-content');
    if (title) title.textContent = 'Properties';
    if (content) content.innerHTML = `<div class="properties-empty"><div class="empty-icon">⬡</div><p>Select a block on the canvas to configure it</p></div>`;
  }

  function showProperties(blockId) {
    const block = blocks.get(blockId);
    if (!block) return;
    const def = FlowBlocks.get(block.type);
    if (!def) return;

    const title = document.getElementById('properties-title');
    const content = document.getElementById('properties-content');
    if (title) title.innerHTML = `<span style="color:${def.color}">${def.icon}</span> ${def.label}`;

    if (!def.params || def.params.length === 0) {
      content.innerHTML = `<div class="properties-empty"><p>${def.label} has no configurable parameters.</p></div>`;
      return;
    }

    content.innerHTML = def.params.map(param => buildParamHTML(blockId, param, block.params[param.name])).join('');

    // Bind change events
    def.params.forEach(param => {
      const key = `${blockId}_${param.name}`;
      const inputEl = document.getElementById(`prop-${key}`);
      const valEl = document.getElementById(`propval-${key}`);
      if (!inputEl) return;

      function onChange() {
        let val;
        if (param.type === 'toggle') val = inputEl.checked;
        else if (param.type === 'slider' || param.type === 'number') val = parseFloat(inputEl.value);
        else val = inputEl.value;
        block.params[param.name] = val;
        if (valEl) valEl.textContent = formatParamVal(param, val);
        updateBlockBody(blockId);
      }
      inputEl.addEventListener('input', onChange);
      inputEl.addEventListener('change', onChange);
    });
  }

  function buildParamHTML(blockId, param, currentVal) {
    const key = `${blockId}_${param.name}`;
    const val = currentVal ?? param.default;

    if (param.type === 'slider') {
      return `
        <div class="prop-row">
          <label class="prop-label" for="prop-${key}">${param.label}</label>
          <div class="prop-slider-wrap">
            <input type="range" id="prop-${key}" class="prop-slider"
              min="${param.min}" max="${param.max}" step="${param.step}" value="${val}">
            <span class="prop-val" id="propval-${key}">${val} ${param.unit || ''}</span>
          </div>
        </div>`;
    }
    if (param.type === 'number') {
      return `
        <div class="prop-row">
          <label class="prop-label" for="prop-${key}">${param.label}</label>
          <div class="prop-number-wrap">
            <input type="number" id="prop-${key}" class="prop-number"
              value="${val}" step="0.01">
            <span class="prop-unit">${param.unit || ''}</span>
          </div>
        </div>`;
    }
    if (param.type === 'toggle') {
      return `
        <div class="prop-row prop-toggle-row">
          <label class="prop-label" for="prop-${key}">${param.label}</label>
          <label class="toggle-switch">
            <input type="checkbox" id="prop-${key}" ${val ? 'checked' : ''}>
            <span class="toggle-knob"></span>
          </label>
        </div>`;
    }
    if (param.type === 'text') {
      return `
        <div class="prop-row">
          <label class="prop-label" for="prop-${key}">${param.label}</label>
          <input type="text" id="prop-${key}" class="prop-text" value="${val}">
        </div>`;
    }
    return '';
  }

  function updateBlockBody(blockId) {
    const block = blocks.get(blockId);
    if (!block) return;
    const def = FlowBlocks.get(block.type);
    if (!def) return;
    const el = document.getElementById(`block-${blockId}`);
    if (!el) return;
    const body = el.querySelector('.block-body');
    if (!body) return;
    body.innerHTML = def.params.map(p => {
      const val = block.params[p.name] ?? p.default;
      return `<div class="block-param-row">
        <span class="param-name">${p.label}</span>
        <span class="param-value">${formatParamVal(p, val)}</span>
      </div>`;
    }).join('');
  }

  /* ════════════════════════════════════════
     EXECUTION HIGHLIGHTING
  ════════════════════════════════════════ */
  function setBlockExecuting(blockId, active) {
    const el = document.getElementById(`block-${blockId}`);
    if (!el) return;
    el.classList.toggle('executing', active);
    // Animate connections from this block
    connections.forEach(conn => {
      if (conn.sourceId !== blockId) return;
      const g = connGroup.querySelector(`[data-conn-id="${conn.id}"]`);
      if (!g) return;
      const path = g.querySelector('path:not(:first-child)');
      if (!path) return;
      if (active) {
        path.setAttribute('stroke', '#00ff88');
        path.setAttribute('stroke-dasharray', '10,5');
        path.setAttribute('marker-end', 'url(#arrow-exec)');
        path.style.filter = 'url(#glow-green)';
      } else {
        path.setAttribute('stroke', '#344d66');
        path.setAttribute('stroke-dasharray', '');
        path.setAttribute('marker-end', 'url(#arrow-default)');
        path.style.filter = '';
      }
    });
  }

  function clearAllExecuting() {
    document.querySelectorAll('.block-node.executing').forEach(el => el.classList.remove('executing'));
    connGroup.querySelectorAll('path').forEach(p => {
      p.setAttribute('stroke', '#344d66');
      p.setAttribute('stroke-dasharray', '');
      p.setAttribute('marker-end', 'url(#arrow-default)');
      p.style.filter = '';
    });
  }

  /* ════════════════════════════════════════
     SAVE / LOAD
  ════════════════════════════════════════ */
  function serialize() {
    return JSON.stringify({
      version: 1,
      blocks: [...blocks.values()],
      connections: [...connections.values()],
    }, null, 2);
  }

  function deserialize(json) {
    try {
      const data = JSON.parse(json);
      blocks = new Map();
      connections = new Map();
      canvasEl.innerHTML = '';
      connGroup.innerHTML = '';

      (data.blocks || []).forEach(b => blocks.set(b.id, b));
      (data.connections || []).forEach(c => connections.set(c.id, c));

      // Update nextId
      let maxId = 0;
      [...blocks.keys(), ...connections.keys()].forEach(id => {
        const n = parseInt(id.slice(1), 10);
        if (!isNaN(n) && n > maxId) maxId = n;
      });
      nextId = maxId + 1;

      renderAll();
      showToast('Flow loaded!', 'success');
    } catch (err) {
      showToast('Failed to load flow: ' + err.message, 'error');
    }
  }

  function clearAll() {
    blocks.clear();
    connections.clear();
    nextId = 1;
    canvasEl.innerHTML = '';
    connGroup.innerHTML = '';
    selectedId = null;
    showPropertiesEmpty();
    addBlock('start', 60,  100);
    addBlock('end',   480, 100);
    renderAll();
    showToast('Canvas cleared', 'info');
  }

  /* ════════════════════════════════════════
     PUBLIC API
  ════════════════════════════════════════ */
  return {
    init,
    addBlock,
    deleteBlock,
    findBlockByType,
    getBlock,
    getConnections,
    selectBlock,
    setBlockExecuting,
    clearAllExecuting,
    serialize,
    deserialize,
    clearAll,
    renderAll,
  };
})();
