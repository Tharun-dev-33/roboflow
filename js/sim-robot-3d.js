/**
 * RoboFlow — Three.js AMR mock: side dock in Flow & Remote.
 * ROS REP-103: base_link +X forward, +Y left; world XZ plane, Y up.
 * cmd_vel linear.x drives forward along robot heading (yaw about Y).
 */
const SimRobot3D = (() => {
  let containerEl = null;
  let renderer = null;
  let scene = null;
  let camera = null;
  let robot = null;
  let robotCarrySlot = null;
  let shelves = null;
  let boxes = [];
  let dockZone = null;
  let carriedBox = null;
  let pickupRing = null;
  let dockRing = null;
  let pathLine = null;
  let pathPoints = [];
  let pathDrawMode = false;
  let pathFollowActive = false;
  let pathFollowIndex = 0;
  let pointerDown = false;
  let drawHandlersBound = false;
  let grid = null;
  let roomGroup = null;
  let goalMarker = null;
  let rafId = null;
  let inited = false;

  /** World pose: +X east, +Z north (map x, map y displayed as x,z) */
  let px = 0;
  let pz = 0;
  /** Yaw: rotation from world +X toward +Z (ROS standard around +Y) */
  let yaw = 0;
  let vx = 0;
  let vy = 0;
  let wz = 0;
  let targetVx = 0;
  let targetVy = 0;
  let targetWz = 0;
  let currentAccel = 0;
  let currentYawAccel = 0;

  let navAnim = null;
  /** In-place turn (smooth yaw), works even when followOdom would ignore cmd_vel */
  let spinAnim = null;
  /** Drive toward nearest / named cargo then pickupCargo */
  let pickupApproach = null;
  let followOdom = false;
  let odomSub = null;
  let lastFrame = performance.now();

  /** follow = chase behind; first = robot-eye; side = profile; top = overhead */
  let cameraMode = 'follow';
  let roomMode = 'plain';

  const camThird = new THREE.Vector3();
  const camLerp = new THREE.Vector3();

  let sceneHemi = null;
  let sceneDir = null;
  let raycaster = null;
  let groundPlane = null;
  const PICKUP_RADIUS = 8.0;
  const DROP_RADIUS = 5.0;
  const PICKUP_STANDOFF = 1.05;

  function quatToYaw(x, y, z, w) {
    return Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z));
  }

  function buildRoomPlain() {
    const g = new THREE.Group();
    const R = 12;
    const H = 5.2;

    const floorMat = new THREE.MeshStandardMaterial({
      color: 0x252a32,
      metalness: 0.15,
      roughness: 0.88,
    });
    const floor = new THREE.Mesh(new THREE.BoxGeometry(R * 2, 0.12, R * 2), floorMat);
    floor.position.y = -0.06;
    floor.receiveShadow = true;
    g.add(floor);

    const lineMat = new THREE.MeshStandardMaterial({
      color: 0xf5c400,
      emissive: 0x665500,
      emissiveIntensity: 0.35,
      roughness: 0.7,
    });
    for (let z = -8; z <= 8; z += 4) {
      const line = new THREE.Mesh(new THREE.BoxGeometry(R * 2 - 1.2, 0.02, 0.08), lineMat);
      line.position.set(0, 0.01, z);
      g.add(line);
    }

    const wallMat = new THREE.MeshStandardMaterial({
      color: 0x3a4555,
      metalness: 0.2,
      roughness: 0.78,
      side: THREE.DoubleSide,
    });
    const wallT = 0.18;
    const wgeom = new THREE.BoxGeometry(R * 2, H, wallT);
    const w1 = new THREE.Mesh(wgeom, wallMat);
    w1.position.set(0, H / 2, -R);
    w1.castShadow = true;
    w1.receiveShadow = true;
    const w2 = new THREE.Mesh(wgeom, wallMat);
    w2.position.set(0, H / 2, R);
    w2.castShadow = true;
    w2.receiveShadow = true;
    const w3 = new THREE.Mesh(new THREE.BoxGeometry(wallT, H, R * 2), wallMat);
    w3.position.set(-R, H / 2, 0);
    w3.castShadow = true;
    const w4 = new THREE.Mesh(new THREE.BoxGeometry(wallT, H, R * 2), wallMat);
    w4.position.set(R, H / 2, 0);
    w4.castShadow = true;
    g.add(w1, w2, w3, w4);

    // Keep factory open-top (no roof/lids) for better visibility and access.

    const warm = 0xffeedd;
    [[-R * 0.65, 2.2, -R * 0.65], [R * 0.65, 2.2, R * 0.65], [-R * 0.65, 2.2, R * 0.65], [R * 0.65, 2.2, -R * 0.65]].forEach(
      ([x, y, z]) => {
        const pl = new THREE.PointLight(warm, 0.55, 28, 1.8);
        pl.position.set(x, y, z);
        g.add(pl);
      }
    );

    const spot = new THREE.SpotLight(0xe8f0ff, 0.85, 40, Math.PI / 5, 0.35, 1);
    spot.position.set(0, H - 0.3, 0);
    spot.target.position.set(0, 0, 0);
    g.add(spot);
    g.add(spot.target);

    return g;
  }

  function buildFactorySet() {
    const g = new THREE.Group();
    const rackMat = new THREE.MeshStandardMaterial({ color: 0x5e6672, metalness: 0.45, roughness: 0.52 });
    const shelfMat = new THREE.MeshStandardMaterial({ color: 0x8a93a0, metalness: 0.3, roughness: 0.62 });
    const makeRack = (x, z, rot = 0) => {
      const r = new THREE.Group();
      r.position.set(x, 0, z);
      r.rotation.y = rot;
      const postPos = [[-1.1, 1.2, -0.35], [1.1, 1.2, -0.35], [-1.1, 1.2, 0.35], [1.1, 1.2, 0.35]];
      postPos.forEach(([px, py, pz]) => {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.09, 2.4, 0.09), rackMat);
        post.position.set(px, py, pz);
        post.castShadow = true;
        r.add(post);
      });
      [0.35, 1.2, 2.05].forEach(y => {
        const sh = new THREE.Mesh(new THREE.BoxGeometry(2.28, 0.08, 0.82), shelfMat);
        sh.position.set(0, y, 0);
        sh.receiveShadow = true;
        r.add(sh);
      });
      g.add(r);
    };
    makeRack(-6.4, -5.6, 0);
    makeRack(-6.4, 5.6, 0);
    makeRack(6.2, -5.6, Math.PI);
    makeRack(6.2, 5.6, Math.PI);
    return g;
  }

  function makeTextSprite(text) {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 72;
    const ctx = c.getContext('2d');
    ctx.fillStyle = 'rgba(16,18,22,0.85)';
    ctx.fillRect(0, 8, 256, 56);
    ctx.strokeStyle = 'rgba(224,218,206,0.7)';
    ctx.strokeRect(2, 10, 252, 52);
    ctx.font = 'bold 24px Inter, sans-serif';
    ctx.fillStyle = '#f0ebdf';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 128, 36);
    const tex = new THREE.CanvasTexture(c);
    tex.needsUpdate = true;
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
    const sp = new THREE.Sprite(mat);
    sp.scale.set(1.1, 0.31, 1);
    sp.position.set(0, 0.55, 0);
    return sp;
  }

  function createDockBox(id, x, z, color = 0xc49a6c) {
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(0.44, 0.36, 0.44),
      new THREE.MeshStandardMaterial({ color, roughness: 0.75, metalness: 0.12 })
    );
    body.position.set(x, 0.18, z);
    body.castShadow = true;
    body.receiveShadow = true;
    body.userData = { cargoId: id, docked: false };
    body.add(makeTextSprite(id));
    return body;
  }

  function buildRobotModel() {
    const g = new THREE.Group();

    const suit = new THREE.MeshStandardMaterial({ color: 0x3e4754, metalness: 0.25, roughness: 0.66 });
    const trim = new THREE.MeshStandardMaterial({ color: 0xd9d4c9, metalness: 0.1, roughness: 0.74 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x23272e, roughness: 0.85 });

    const pelvis = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.18, 0.28), suit);
    pelvis.position.set(0, 0.38, 0);
    pelvis.castShadow = true;
    g.add(pelvis);
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.42, 0.26), suit);
    torso.position.set(0, 0.72, 0);
    torso.castShadow = true;
    g.add(torso);
    const chest = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.18, 0.03), trim);
    chest.position.set(0.14, 0.74, 0.145);
    g.add(chest);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.2), trim);
    head.position.set(0.02, 1.05, 0);
    head.castShadow = true;
    g.add(head);
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.05, 0.02), dark);
    visor.position.set(0.08, 1.06, 0.105);
    g.add(visor);

    [[0.24, 0.73, 0], [-0.24, 0.73, 0]].forEach(([x, y, z]) => {
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.34, 0.12), suit);
      arm.position.set(x, y, z);
      arm.castShadow = true;
      g.add(arm);
      const hand = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1), trim);
      hand.position.set(x, 0.52, z);
      g.add(hand);
    });
    [[0.12, 0.16, 0.08], [0.12, 0.16, -0.08], [-0.12, 0.16, 0.08], [-0.12, 0.16, -0.08]].forEach(([x, y, z]) => {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.08, 14), dark);
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(x, y, z);
      wheel.castShadow = true;
      g.add(wheel);
    });

    robotCarrySlot = new THREE.Object3D();
    robotCarrySlot.position.set(0.34, 0.34, 0);
    g.add(robotCarrySlot);

    const arrow = new THREE.ArrowHelper(
      new THREE.Vector3(1, 0, 0),
      new THREE.Vector3(0.05, 1.1, 0),
      0.42,
      0xd9d4c9,
      0.1,
      0.07
    );
    g.add(arrow);

    return g;
  }

  function applyRoomLighting() {
    if (!scene) return;
    if (roomMode === 'plain') {
      scene.fog = new THREE.Fog(0x0c1018, 10, 72);
      if (sceneHemi) sceneHemi.intensity = 0.42;
      if (sceneDir) {
        sceneDir.intensity = 0.72;
        sceneDir.color.setHex(0xfff5e8);
      }
    } else {
      scene.fog = new THREE.Fog(0x050810, 20, 85);
      if (sceneHemi) sceneHemi.intensity = 0.9;
      if (sceneDir) {
        sceneDir.intensity = 0.45;
        sceneDir.color.setHex(0xffffff);
      }
    }
  }

  function setRoomVisibility() {
    if (!grid || !roomGroup) return;
    if (roomMode === 'plain') {
      grid.visible = false;
      roomGroup.visible = true;
    } else {
      grid.visible = true;
      roomGroup.visible = false;
    }
    applyRoomLighting();
  }

  function buildScene() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x101214);
    scene.fog = new THREE.Fog(0x101214, 22, 88);

    sceneHemi = new THREE.HemisphereLight(0x8899bb, 0x0a0c12, 0.9);
    scene.add(sceneHemi);
    sceneDir = new THREE.DirectionalLight(0xffffff, 0.45);
    sceneDir.position.set(10, 24, 12);
    sceneDir.castShadow = true;
    sceneDir.shadow.mapSize.set(2048, 2048);
    sceneDir.shadow.camera.near = 2;
    sceneDir.shadow.camera.far = 60;
    sceneDir.shadow.camera.left = -22;
    sceneDir.shadow.camera.right = 22;
    sceneDir.shadow.camera.top = 22;
    sceneDir.shadow.camera.bottom = -22;
    scene.add(sceneDir);

    const fill = new THREE.DirectionalLight(0x4466aa, 0.18);
    fill.position.set(-12, 8, -8);
    scene.add(fill);
    raycaster = new THREE.Raycaster();
    groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

    grid = new THREE.GridHelper(56, 56, 0x3f444d, 0x252930);
    grid.position.y = 0.002;
    scene.add(grid);

    roomGroup = buildRoomPlain();
    roomGroup.visible = false;
    scene.add(roomGroup);
    shelves = buildFactorySet();
    roomGroup.add(shelves);

    robot = buildRobotModel();
    scene.add(robot);
    pickupRing = new THREE.Mesh(
      new THREE.RingGeometry(PICKUP_RADIUS - 0.05, PICKUP_RADIUS, 48),
      new THREE.MeshBasicMaterial({ color: 0xff7777, transparent: true, opacity: 0.22, side: THREE.DoubleSide })
    );
    pickupRing.rotation.x = -Math.PI / 2;
    pickupRing.position.y = 0.01;
    scene.add(pickupRing);
    boxes = [
      createDockBox('CARGO-A1', -6.1, -5.6, 0xbd8f62),
      createDockBox('CARGO-A2', -6.1, 5.6, 0xd3a678),
      createDockBox('CARGO-B1', 6.0, -5.6, 0xba9268),
      createDockBox('CARGO-B2', 6.0, 5.6, 0xc89f73),
    ];
    boxes.forEach(b => roomGroup.add(b));
    dockZone = new THREE.Mesh(
      new THREE.CylinderGeometry(0.95, 0.95, 0.02, 28),
      new THREE.MeshStandardMaterial({
        color: 0xd9d4c9,
        emissive: 0x3a362f,
        emissiveIntensity: 0.2,
        transparent: true,
        opacity: 0.65,
      })
    );
    dockZone.position.set(0, 0.02, 8.2);
    dockZone.receiveShadow = true;
    roomGroup.add(dockZone);
    dockRing = new THREE.Mesh(
      new THREE.RingGeometry(DROP_RADIUS - 0.05, DROP_RADIUS, 48),
      new THREE.MeshBasicMaterial({ color: 0xff7777, transparent: true, opacity: 0.22, side: THREE.DoubleSide })
    );
    dockRing.rotation.x = -Math.PI / 2;
    dockRing.position.set(dockZone.position.x, 0.011, dockZone.position.z);
    roomGroup.add(dockRing);

    pathLine = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([]),
      new THREE.LineBasicMaterial({ color: 0x89b4ff, linewidth: 2 })
    );
    scene.add(pathLine);

    goalMarker = new THREE.Group();
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.28, 0.42, 36),
      new THREE.MeshBasicMaterial({ color: 0x7c3aed, transparent: true, opacity: 0.55, side: THREE.DoubleSide })
    );
    ring.rotation.x = -Math.PI / 2;
    goalMarker.add(ring);
    goalMarker.visible = false;
    scene.add(goalMarker);

    camera = new THREE.PerspectiveCamera(55, 1, 0.08, 220);
    camera.position.set(10, 8, 14);
  }

  function updateCameraFollow() {
    const back = 8.5;
    const up = 5.2;
    const cx = px - Math.cos(yaw) * back;
    const cz = pz - Math.sin(yaw) * back;
    camThird.set(cx, up, cz);
    camLerp.lerp(camThird, 0.14);
    camera.position.copy(camLerp);
    camera.lookAt(px, 0.42, pz);
  }

  function updateCameraFirst() {
    const eye = 1.02;
    const fx = 0.12;
    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);
    camera.position.set(px + cos * fx, eye, pz + sin * fx);
    camera.lookAt(px + cos * 4.6, 0.98, pz + sin * 4.6);
  }

  /** Camera on robot's left (port) side, eye-level — profile of the chassis. */
  function updateCameraSide() {
    const sideDist = 10;
    const height = 3.4;
    const lx = -Math.sin(yaw);
    const lz = Math.cos(yaw);
    const cx = px + lx * sideDist;
    const cz = pz + lz * sideDist;
    camThird.set(cx, height, cz);
    camLerp.lerp(camThird, 0.12);
    camera.position.copy(camLerp);
    camera.lookAt(px, 0.38, pz);
  }

  /** Overhead map-style view. */
  function updateCameraTop() {
    const h = 21;
    camThird.set(px, h, pz);
    camLerp.lerp(camThird, 0.1);
    camera.position.copy(camLerp);
    camera.lookAt(px, 0, pz);
  }

  function snapCameraToMode() {
    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);
    if (cameraMode === 'first') {
      camLerp.set(px + cos * 0.12, 1.02, pz + sin * 0.12);
    } else if (cameraMode === 'side') {
      const lx = -sin;
      const lz = cos;
      camLerp.set(px + lx * 10, 3.4, pz + lz * 10);
    } else if (cameraMode === 'top') {
      camLerp.set(px, 21, pz);
    } else {
      camLerp.set(px - cos * 8.5, 5.2, pz - sin * 8.5);
    }
  }

  function updateCamera() {
    if (cameraMode === 'first') updateCameraFirst();
    else if (cameraMode === 'side') updateCameraSide();
    else if (cameraMode === 'top') updateCameraTop();
    else updateCameraFollow();
  }

  function updateHud() {
    const pose = `map x: ${px.toFixed(2)}  y: ${pz.toFixed(2)}  θ: ${((yaw * 180) / Math.PI).toFixed(1)}°`;
    const tw = `cmd  vx: ${vx.toFixed(2)}  vy: ${vy.toFixed(2)}  ωz: ${wz.toFixed(2)}`;
    const speed = Math.sqrt(vx * vx + vy * vy);
    const nearest = getNearestCargoInfo();
    const pickOk = !carriedBox && nearest && nearest.dist <= PICKUP_RADIUS;
    const dockDist = dockZone ? Math.hypot(dockZone.position.x - px, dockZone.position.z - pz) : 999;
    const dropHereOk = !!carriedBox;
    const dropDockOk = !!carriedBox && dockDist <= DROP_RADIUS;
    const stats = `speed ${speed.toFixed(2)} m/s  acc ${currentAccel.toFixed(2)} m/s²  yaw acc ${currentYawAccel.toFixed(2)} rad/s²  cargo ${carriedBox ? carriedBox.userData.cargoId : 'none'}  pick ${pickOk ? 'ready' : 'no'}  drop ${dropHereOk ? 'here' : 'no'}  dock ${dropDockOk ? 'ok' : '—'}`;
    document.querySelectorAll('.sim-hud-pose').forEach(el => {
      el.textContent = pose;
    });
    document.querySelectorAll('.sim-hud-twist').forEach(el => {
      el.textContent = tw;
    });
    document.querySelectorAll('.sim-hud-stats').forEach(el => {
      el.textContent = stats;
    });
  }

  function smoothTo(current, target, step) {
    if (current < target) return Math.min(current + step, target);
    if (current > target) return Math.max(current - step, target);
    return current;
  }

  function getGroundPoint(clientX, clientY) {
    if (!renderer || !camera || !raycaster || !groundPlane) return null;
    const rect = renderer.domElement.getBoundingClientRect();
    const x = ((clientX - rect.left) / Math.max(rect.width, 1)) * 2 - 1;
    const y = -((clientY - rect.top) / Math.max(rect.height, 1)) * 2 + 1;
    raycaster.setFromCamera(new THREE.Vector2(x, y), camera);
    const p = new THREE.Vector3();
    if (!raycaster.ray.intersectPlane(groundPlane, p)) return null;
    return p;
  }

  function updatePathGeometry() {
    if (!pathLine) return;
    pathLine.geometry.dispose();
    pathLine.geometry = new THREE.BufferGeometry().setFromPoints(pathPoints);
  }

  function clearDrawnPath() {
    pathFollowActive = false;
    pathFollowIndex = 0;
    pathPoints = [];
    updatePathGeometry();
  }

  function setPathDrawMode(on) {
    pathDrawMode = !!on;
    if (renderer?.domElement) renderer.domElement.style.cursor = pathDrawMode ? 'crosshair' : '';
    return pathDrawMode;
  }

  function onDrawPointerDown(e) {
    if (!pathDrawMode) return;
    const p = getGroundPoint(e.clientX, e.clientY);
    if (!p) return;
    pointerDown = true;
    pathFollowActive = false;
    pathFollowIndex = 0;
    pathPoints = [new THREE.Vector3(p.x, 0.03, p.z)];
    updatePathGeometry();
    e.preventDefault();
  }

  function onDrawPointerMove(e) {
    if (!pathDrawMode || !pointerDown) return;
    const p = getGroundPoint(e.clientX, e.clientY);
    if (!p) return;
    const last = pathPoints[pathPoints.length - 1];
    if (!last || Math.hypot(p.x - last.x, p.z - last.z) > 0.25) {
      pathPoints.push(new THREE.Vector3(p.x, 0.03, p.z));
      updatePathGeometry();
    }
  }

  function onDrawPointerUp() {
    pointerDown = false;
  }

  function bindDrawHandlers() {
    if (!renderer || !renderer.domElement || drawHandlersBound) return;
    const el = renderer.domElement;
    el.addEventListener('pointerdown', onDrawPointerDown);
    el.addEventListener('pointermove', onDrawPointerMove);
    window.addEventListener('pointerup', onDrawPointerUp);
    drawHandlersBound = true;
  }

  function followDrawnPath() {
    if (!pathPoints || pathPoints.length < 2) return false;
    pickupApproach = null;
    pathFollowActive = true;
    pathFollowIndex = 0;
    return true;
  }

  function updatePathFollower() {
    if (!pathFollowActive || pathPoints.length < 2) return;
    if (pathFollowIndex >= pathPoints.length) {
      pathFollowActive = false;
      targetVx = 0;
      targetVy = 0;
      targetWz = 0;
      return;
    }
    const target = pathPoints[pathFollowIndex];
    const dx = target.x - px;
    const dz = target.z - pz;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.45) {
      pathFollowIndex += 1;
      return;
    }
    const desiredYaw = Math.atan2(dz, dx);
    let err = desiredYaw - yaw;
    while (err > Math.PI) err -= Math.PI * 2;
    while (err < -Math.PI) err += Math.PI * 2;
    targetWz = Math.max(-2.8, Math.min(2.8, err * 2.2));
    targetVy = 0;
    let fwd = Math.max(0.18, Math.min(1.1, dist * 0.55));
    if (Math.abs(err) > 1.2) fwd = 0.08;
    targetVx = fwd;
  }

  function findCargoById(cargoId) {
    const id = String(cargoId || '').trim().toUpperCase();
    return boxes.find(b => b.userData && String(b.userData.cargoId).toUpperCase() === id) || null;
  }

  function isCargoOnFloor(box) {
    return box && box.parent && box.parent !== robotCarrySlot;
  }

  function getNearestCargoInfo() {
    let best = null;
    for (const box of boxes) {
      if (!isCargoOnFloor(box) || box.userData?.docked) continue;
      const dist = Math.hypot(box.position.x - px, box.position.z - pz);
      if (!best || dist < best.dist) best = { box, dist };
    }
    return best;
  }

  function nearestUndockedBox() {
    let best = null;
    for (const box of boxes) {
      if (!isCargoOnFloor(box) || box.userData?.docked) continue;
      const dx = box.position.x - px;
      const dz = box.position.z - pz;
      const d2 = dx * dx + dz * dz;
      if (!best || d2 < best.d2) best = { box, d2 };
    }
    return best ? best.box : null;
  }

  function resolvePickupTargetBox(cargoArg) {
    const id = String(cargoArg || '').trim();
    const u = id.toUpperCase();
    const pickAny = !u || u === 'ANY';
    if (pickAny) return nearestUndockedBox();
    return findCargoById(id);
  }

  function beginPickupApproach(cargoArg) {
    if (carriedBox) return false;
    const b = resolvePickupTargetBox(cargoArg);
    if (!b || !isCargoOnFloor(b) || b.userData?.docked) return false;
    pathFollowActive = false;
    pathFollowIndex = 0;
    pickupApproach = { arg: String(cargoArg || '').trim() || 'any' };
    return true;
  }

  function cancelPickupApproach() {
    pickupApproach = null;
    targetVx = 0;
    targetVy = 0;
    targetWz = 0;
  }

  function updatePickupApproach(dt) {
    if (!pickupApproach) return;
    if (carriedBox) {
      pickupApproach = null;
      return;
    }
    const b = resolvePickupTargetBox(pickupApproach.arg);
    if (!b || !isCargoOnFloor(b) || b.userData?.docked) {
      cancelPickupApproach();
      return;
    }
    const bx = b.position.x;
    const bz = b.position.z;
    let ux = px - bx;
    let uz = pz - bz;
    let len = Math.hypot(ux, uz);
    if (len < 0.06) {
      ux = 1;
      uz = 0;
      len = 1;
    }
    ux /= len;
    uz /= len;
    const gx = bx + ux * PICKUP_STANDOFF;
    const gz = bz + uz * PICKUP_STANDOFF;
    const dx = gx - px;
    const dz = gz - pz;
    const dist = Math.hypot(dx, dz);
    const faceBox = Math.atan2(bz - pz, bx - px);
    let desiredYaw = Math.atan2(dz, dx);
    if (dist < 0.52) desiredYaw = faceBox;

    let err = desiredYaw - yaw;
    while (err > Math.PI) err -= Math.PI * 2;
    while (err < -Math.PI) err += Math.PI * 2;
    targetWz = Math.max(-2.5, Math.min(2.5, err * 2.6));
    targetVy = 0;
    let fwd = Math.max(0.18, Math.min(0.92, dist * 0.62));
    if (Math.abs(err) > 0.92) fwd = 0.1;
    if (dist < 0.38) fwd = Math.min(fwd, 0.32);
    targetVx = fwd;

    let ferr = faceBox - yaw;
    while (ferr > Math.PI) ferr -= Math.PI * 2;
    while (ferr < -Math.PI) ferr += Math.PI * 2;
    if (dist < 0.44 && Math.abs(ferr) < 0.42) {
      if (pickupCargo(pickupApproach.arg)) cancelPickupApproach();
    }
  }

  function pickupCargo(cargoId) {
    if (carriedBox) return false;
    const id = String(cargoId || '').trim();
    const u = id.toUpperCase();
    const pickAny = !u || u === 'ANY';
    let b = null;
    if (pickAny) {
      b = nearestUndockedBox();
    } else {
      b = findCargoById(id);
      if (!b) return false;
    }
    if (!b || !b.parent) return false;
    const dx = b.position.x - px;
    const dz = b.position.z - pz;
    if (dx * dx + dz * dz > PICKUP_RADIUS * PICKUP_RADIUS) return false;
    carriedBox = b;
    robotCarrySlot.add(b);
    b.position.set(0, 0.28, 0);
    b.userData.docked = false;
    return true;
  }

  function dropCargo(cargoId) {
    if (!carriedBox) return false;
    const arg = String(cargoId || '').trim();
    const u = arg.toUpperCase();
    const atDock =
      dockZone && Math.hypot(dockZone.position.x - px, dockZone.position.z - pz) <= DROP_RADIUS;
    const carriedId = String(carriedBox.userData.cargoId || '').toUpperCase();

    if (u === 'DOCK') {
      if (!atDock) return false;
      roomGroup.add(carriedBox);
      carriedBox.position.set(dockZone.position.x, 0.2, dockZone.position.z);
      carriedBox.userData.docked = true;
      carriedBox = null;
      return true;
    }

    if (u && u !== 'HERE' && u !== 'ANY') {
      if (!/^CARGO-/i.test(arg)) return false;
      if (carriedId !== u) return false;
    }

    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    const offset = 0.52;
    const gx = px + c * offset;
    const gz = pz + s * offset;
    roomGroup.add(carriedBox);
    carriedBox.position.set(gx, 0.2, gz);
    carriedBox.userData.docked = false;
    carriedBox = null;
    return true;
  }

  function handleCargoCommand(cmd) {
    const raw = String(cmd || '').trim();
    const ci = raw.indexOf(':');
    const verb = ci >= 0 ? raw.slice(0, ci) : raw;
    const arg = ci >= 0 ? raw.slice(ci + 1) : '';
    const v = String(verb || '').toLowerCase();
    if (v === 'pickup') {
      if (carriedBox) return false;
      if (pickupCargo(arg || '')) return true;
      return beginPickupApproach(arg || '');
    }
    if (v === 'drop') return dropCargo(arg || '');
    return false;
  }

  function tick(now) {
    rafId = requestAnimationFrame(tick);
    const dt = Math.min(0.08, (now - lastFrame) / 1000);
    lastFrame = now;

    if (spinAnim) {
      const u = Math.min(1, (now - spinAnim.t0) / spinAnim.durMs);
      const s = 0.5 - 0.5 * Math.cos(Math.PI * u);
      yaw = spinAnim.syaw + spinAnim.dy * s;
      vx = vy = wz = 0;
      targetVx = targetVy = targetWz = 0;
      if (u >= 1) spinAnim = null;
    } else if (navAnim) {
      const u = Math.min(1, (now - navAnim.t0) / navAnim.durMs);
      const s = 0.5 - 0.5 * Math.cos(Math.PI * u);
      px = navAnim.sx + (navAnim.tx - navAnim.sx) * s;
      pz = navAnim.sz + (navAnim.tz - navAnim.sz) * s;
      let dy = navAnim.tyaw - navAnim.syaw;
      while (dy > Math.PI) dy -= Math.PI * 2;
      while (dy < -Math.PI) dy += Math.PI * 2;
      yaw = navAnim.syaw + dy * s;
      if (u >= 1) navAnim = null;
    } else if (pickupApproach || !followOdom) {
      if (pickupApproach) updatePickupApproach(dt);
      else updatePathFollower();
      const linAccelLimit = 2.8;
      const angAccelLimit = 4.8;
      const prevVx = vx;
      const prevVy = vy;
      const prevWz = wz;
      vx = smoothTo(vx, targetVx, linAccelLimit * dt);
      vy = smoothTo(vy, targetVy, linAccelLimit * dt);
      wz = smoothTo(wz, targetWz, angAccelLimit * dt);
      currentAccel = Math.sqrt((vx - prevVx) ** 2 + (vy - prevVy) ** 2) / Math.max(dt, 1e-3);
      currentYawAccel = Math.abs(wz - prevWz) / Math.max(dt, 1e-3);
      const c = Math.cos(yaw);
      const s = Math.sin(yaw);
      px += (c * vx - s * vy) * dt;
      pz += (s * vx + c * vy) * dt;
      yaw += wz * dt;
    }

    robot.position.set(px, 0, pz);
    robot.rotation.y = yaw;
    if (pickupRing) {
      pickupRing.position.set(px, 0.01, pz);
      const nearest = getNearestCargoInfo();
      const ok = !carriedBox && nearest && nearest.dist <= PICKUP_RADIUS;
      pickupRing.material.color.setHex(ok ? 0x79ff9d : 0xff7777);
    }
    if (dockRing) {
      const d = dockZone ? Math.hypot(dockZone.position.x - px, dockZone.position.z - pz) : 999;
      const ok = !!carriedBox && d <= DROP_RADIUS;
      dockRing.material.color.setHex(ok ? 0x79ff9d : carriedBox ? 0xffaa44 : 0xff7777);
    }
    updateCamera();
    updateHud();
    if (renderer && scene && camera) renderer.render(scene, camera);
  }

  function initIfNeeded(el) {
    if (typeof THREE === 'undefined') {
      console.warn('[SimRobot3D] THREE.js not loaded');
      return false;
    }
    if (!el) return false;

    if (!inited) {
      containerEl = el;
      const w = el.clientWidth || 400;
      const h = el.clientHeight || 300;

      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setSize(w, h);
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      el.appendChild(renderer.domElement);

      buildScene();
      bindDrawHandlers();
      snapCameraToMode();
      lastFrame = performance.now();
      rafId = requestAnimationFrame(tick);
      inited = true;
    } else {
      setContainer(el);
    }

    setRoomVisibility();
    resize();
    return true;
  }

  function setContainer(el) {
    if (!el || !renderer) return;
    if (renderer.domElement.parentNode) {
      renderer.domElement.parentNode.removeChild(renderer.domElement);
    }
    containerEl = el;
    el.appendChild(renderer.domElement);
    resize();
  }

  function resize() {
    if (!renderer || !containerEl || !camera) return;
    const w = containerEl.clientWidth || 400;
    const h = containerEl.clientHeight || 300;
    camera.aspect = w / Math.max(h, 1);
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  }

  function dispose() {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;
    pickupApproach = null;
    spinAnim = null;
    detachOdom();
    if (renderer) {
      renderer.dispose();
      if (containerEl && renderer.domElement.parentNode === containerEl) {
        containerEl.removeChild(renderer.domElement);
      }
    }
    renderer = null;
    scene = null;
    camera = null;
    robot = null;
    grid = null;
    roomGroup = null;
    sceneHemi = null;
    sceneDir = null;
    inited = false;
  }

  function applyCmdVel(linearX, linearY, angularZ) {
    if (Math.abs(linearX) > 1e-4 || Math.abs(linearY) > 1e-4 || Math.abs(angularZ) > 1e-4) {
      pathFollowActive = false;
      pickupApproach = null;
      spinAnim = null;
    }
    targetVx = Number(linearX) || 0;
    targetVy = Number(linearY) || 0;
    targetWz = Number(angularZ) || 0;
  }

  /** Positive deltaYaw = turn left (CCW from above). */
  function rotateInPlace(deltaYawRad, durationSec = 1.25) {
    spinAnim = null;
    navAnim = null;
    pickupApproach = null;
    pathFollowActive = false;
    targetVx = targetVy = targetWz = 0;
    vx = vy = wz = 0;
    spinAnim = {
      t0: performance.now(),
      durMs: Math.max(0.35, durationSec) * 1000,
      syaw: yaw,
      dy: Number(deltaYawRad) || 0,
    };
  }

  function navigateTo(mapX, mapY, theta, durationSec = 3) {
    navAnim = null;
    pickupApproach = null;
    const tx = mapX;
    const tz = mapY;
    const tyaw = theta;
    navAnim = {
      t0: performance.now(),
      durMs: Math.max(0.4, durationSec) * 1000,
      sx: px,
      sz: pz,
      syaw: yaw,
      tx,
      tz,
      tyaw,
    };
    goalMarker.position.set(tx, 0.03, tz);
    goalMarker.visible = true;
    setTimeout(() => {
      if (goalMarker) goalMarker.visible = false;
    }, durationSec * 1000 + 400);
  }

  function resetPose() {
    navAnim = null;
    spinAnim = null;
    pickupApproach = null;
    px = 0;
    pz = 0;
    yaw = 0;
    vx = vy = wz = 0;
    targetVx = targetVy = targetWz = 0;
    currentAccel = 0;
    currentYawAccel = 0;
    pathFollowActive = false;
    pathFollowIndex = 0;
    if (goalMarker) goalMarker.visible = false;
    snapCameraToMode();
  }

  function setFollowOdom(on) {
    followOdom = !!on;
    if (!followOdom) {
      vx = vy = wz = 0;
      targetVx = targetVy = targetWz = 0;
    }
  }

  function setCameraMode(mode) {
    if (mode === 'first' || mode === 'side' || mode === 'top') cameraMode = mode;
    else cameraMode = 'follow';
    snapCameraToMode();
  }

  function setRoomMode(mode) {
    roomMode = mode === 'plain' ? 'plain' : 'open';
    setRoomVisibility();
  }

  function syncCollapsedUi(collapsed) {
    document.querySelectorAll('.sim-dock').forEach(dock => {
      dock.classList.toggle('collapsed', collapsed);
    });
    document.querySelectorAll('.js-sim-collapse').forEach(btn => {
      btn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
      btn.textContent = collapsed ? '▶' : '▾';
    });
  }

  function detachOdom() {
    if (odomSub) {
      try {
        odomSub.unsubscribe();
      } catch (_) {}
      odomSub = null;
    }
  }

  function attachRosOdom(ros, topicName = '/odom') {
    detachOdom();
    if (typeof ROSLIB === 'undefined' || !ros) return;
    odomSub = new ROSLIB.Topic({
      ros,
      name: topicName,
      messageType: 'nav_msgs/Odometry',
    });
    odomSub.subscribe(msg => {
      if (!followOdom) return;
      if (pickupApproach || spinAnim) return;
      const p = msg.pose.pose.position;
      const o = msg.pose.pose.orientation;
      px = p.x;
      pz = p.y;
      yaw = quatToYaw(o.x, o.y, o.z, o.w);
    });
  }

  return {
    initIfNeeded,
    setContainer,
    resize,
    dispose,
    applyCmdVel,
    rotateInPlace,
    navigateTo,
    resetPose,
    setFollowOdom,
    setCameraMode,
    setRoomMode,
    setPathDrawMode,
    followDrawnPath,
    clearDrawnPath,
    isPathDrawMode: () => pathDrawMode,
    handleCargoCommand,
    attachRosOdom,
    detachOdom,
    getFollowOdom: () => followOdom,
    syncCollapsedUi,
  };
})();

window.SimRobot3D = SimRobot3D;
