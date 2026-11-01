import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { STEP, makePiece, samplePiece, pieceLength, pieceFromSocket, topology, canPlace, advancePosition, demoPieces } from './track.js';

const $ = (selector) => document.querySelector(selector);
const sceneElement = $('#scene');
const STORAGE_KEY = 'little-railway-v1';
const TOOLS = ['straight', 'left', 'right', 'erase', 'train-mint', 'train-coral'];
const TRAIN_NAMES = { mint: 'ミント号', coral: 'あかい特急' };
let pieces = demoPieces();
let train = { type: 'mint', pieceId: 1, t: 0.75, forward: true };
let activeTool = 'straight';
let running = false;
let history = [];
let nextId = 9;
let topo = topology(pieces);
let toastTimer;
let hoveredSocket = null;

function loadSaved() {
  try {
    const data = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!data || data.version !== 1 || !Array.isArray(data.pieces) || data.pieces.length < 1 || data.pieces.length > 80) return;
    const valid = data.pieces.every((p) => Number.isInteger(p.id) && p.start && p.dir && Number.isInteger(p.start.x) && Number.isInteger(p.start.z) && Math.abs(p.start.x) <= 5 && Math.abs(p.start.z) <= 5 && Math.abs(p.dir.x) + Math.abs(p.dir.z) === 1 && [-1, 0, 1].includes(p.turn));
    if (!valid || new Set(data.pieces.map((p) => p.id)).size !== data.pieces.length) return;
    pieces = data.pieces;
    train = data.train && TRAIN_NAMES[data.train.type] && pieces.some((p) => p.id === data.train.pieceId) && Number.isFinite(data.train.t) && data.train.t >= 0 && data.train.t <= 1
      ? { type: data.train.type, pieceId: data.train.pieceId, t: data.train.t, forward: !!data.train.forward } : null;
    nextId = Math.max(...pieces.map((p) => p.id)) + 1;
    topo = topology(pieces);
  } catch { /* A fresh course is used if saved data cannot be read. */ }
}
function save() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, pieces, train })); } catch { /* The game remains usable if storage is unavailable. */ }
}
function remember() {
  history.push(JSON.stringify({ pieces, train, nextId }));
  if (history.length > 30) history.shift();
}
function message(text) {
  const toast = $('#toast');
  toast.textContent = text;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2600);
}
loadSaved();

const scene = new THREE.Scene();
scene.background = new THREE.Color('#edf1e6');
const camera = new THREE.OrthographicCamera(-12, 12, 9, -9, .1, 100);
camera.position.set(13, 16, 20);
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.6));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
sceneElement.appendChild(renderer.domElement);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.enablePan = false;
controls.minZoom = 0.65;
controls.maxZoom = 2.1;
controls.minPolarAngle = 0.42;
controls.maxPolarAngle = 1.27;
controls.update();
scene.add(new THREE.HemisphereLight('#ffffff', '#bacdb4', 2.0));
const sunlight = new THREE.DirectionalLight('#fff8e9', 2.3);
sunlight.position.set(-7, 17, 11);
sunlight.castShadow = true;
sunlight.shadow.mapSize.set(2048, 2048);
sunlight.shadow.camera.left = -16;
sunlight.shadow.camera.right = 16;
sunlight.shadow.camera.top = 16;
sunlight.shadow.camera.bottom = -16;
sunlight.shadow.normalBias = 0.035;
sunlight.shadow.bias = -0.0002;
scene.add(sunlight);

const mat = (color, options = {}) => new THREE.MeshStandardMaterial({ color, roughness: .82, ...options });
const materials = {
  boardEdge: mat('#d4e4ce'), boardTop: mat('#e0edda'), ground: mat('#e8eee2'),
  rail: mat('#238fce', { roughness: .38 }), ridge: mat('#69caef', { roughness: .34 }), tie: mat('#41a9dc', { roughness: .45 }),
  ghost: new THREE.MeshBasicMaterial({ color: '#45b8ea', transparent: true, opacity: .42, depthWrite: false }),
  ghostBad: new THREE.MeshBasicMaterial({ color: '#e9886e', transparent: true, opacity: .42, depthWrite: false }),
  cream: mat('#fff9e8'), white: mat('#f8f6e9'), mint: mat('#70b99b'), mintDark: mat('#519d82'), coral: mat('#e67f6b'),
  window: mat('#506e75', { roughness: .4 }), windowLight: mat('#a9d7d5', { roughness: .4 }),
  wheel: mat('#3b5351'), wheelInner: mat('#91a39a'), roof: mat('#e9e7dc'),
  station: mat('#f7e8c7'), stationRoof: mat('#729f8b'), door: mat('#ad8366'),
  trunk: mat('#b4916c'), leaf: mat('#91bd93'), leafLight: mat('#b4d4a6'), leafDark: mat('#79ae8c'),
  flowerYellow: mat('#f2ca7d'), flowerWhite: mat('#fff8dd'), flowerPink: mat('#eab7a4'),
};
function roundedShape(width, depth, radius) {
  const x = -width / 2, y = -depth / 2, w = width, h = depth, r = radius;
  const shape = new THREE.Shape();
  shape.moveTo(x + r, y); shape.lineTo(x + w - r, y); shape.quadraticCurveTo(x + w, y, x + w, y + r);
  shape.lineTo(x + w, y + h - r); shape.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  shape.lineTo(x + r, y + h); shape.quadraticCurveTo(x, y + h, x, y + h - r);
  shape.lineTo(x, y + r); shape.quadraticCurveTo(x, y, x + r, y);
  return shape;
}
function boardLayer(width, depth, radius, y, thickness, material) {
  const geometry = new THREE.ExtrudeGeometry(roundedShape(width, depth, radius), { depth: thickness, bevelEnabled: false, curveSegments: 10 });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = y;
  mesh.receiveShadow = true;
  mesh.castShadow = true;
  scene.add(mesh);
}
const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), materials.ground);
ground.rotation.x = -Math.PI / 2;
ground.position.y = -.51;
ground.receiveShadow = true;
scene.add(ground);
boardLayer(19.5, 15.5, .8, -.48, .20, materials.boardEdge);
boardLayer(19.1, 15.1, .72, -.28, .24, materials.boardTop);

// A subtle dotted play mat, generated locally without external image assets.
const gridCanvas = document.createElement('canvas');
gridCanvas.width = 1024; gridCanvas.height = 800;
const gridContext = gridCanvas.getContext('2d');
gridContext.fillStyle = 'rgba(108,155,118,.18)';
for (let x = 30; x < 1024; x += 64) for (let y = 30; y < 800; y += 64) {
  gridContext.beginPath(); gridContext.arc(x, y, 2.4, 0, Math.PI * 2); gridContext.fill();
}
const gridTexture = new THREE.CanvasTexture(gridCanvas);
gridTexture.colorSpace = THREE.SRGBColorSpace;
const grid = new THREE.Mesh(new THREE.PlaneGeometry(18.2, 14.1), new THREE.MeshBasicMaterial({ map: gridTexture, transparent: true, depthWrite: false, opacity: .65 }));
grid.rotation.x = -Math.PI / 2; grid.position.y = -.035; scene.add(grid);

function box(width, height, depth, material, x, y, z, radius = .06) {
  const geometry = new RoundedBoxGeometry(width, height, depth, 2, Math.min(radius, width / 3, height / 3, depth / 3));
  geometry.userData.disposable = true;
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(x, y, z); mesh.castShadow = true; mesh.receiveShadow = true;
  return mesh;
}
const decor = [];
function tree(x, z, scale = 1, color = materials.leaf) {
  const group = new THREE.Group();
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(.09 * scale, .13 * scale, .65 * scale, 7), materials.trunk);
  trunk.position.y = .28 * scale; trunk.castShadow = true; group.add(trunk);
  const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(.5 * scale, 1), color);
  crown.position.y = .85 * scale; crown.scale.set(.9, 1.1, .9); crown.castShadow = true; group.add(crown);
  group.position.set(x, 0, z); scene.add(group); decor.push({ group, x, z, radius: .68 * scale });
}
function flowers(x, z, color) {
  const group = new THREE.Group();
  for (let i = 0; i < 5; i++) {
    const f = new THREE.Mesh(new THREE.SphereGeometry(.065, 6, 5), color);
    f.position.set((i % 3 - 1) * .16, .025, (Math.floor(i / 3) - .5) * .16); group.add(f);
  }
  group.position.set(x, 0, z); scene.add(group); decor.push({ group, x, z, radius: .35 });
}
tree(-8.1, -5.8, 1.05, materials.leaf); tree(-7.15, -6.05, .67, materials.leafLight);
tree(7.8, -5.8, .88, materials.leafDark); tree(8.4, -4.9, .6, materials.leafLight);
tree(-8.2, 5.6, .9, materials.leafLight); tree(-7.35, 5.95, .65, materials.leaf);
tree(7.8, 5.9, 1, materials.leaf); tree(8.5, 5.05, .65, materials.leafLight);
flowers(-6.8, 5.0, materials.flowerYellow); flowers(6.8, -5.5, materials.flowerPink);
flowers(6.7, 5.7, materials.flowerWhite); flowers(-6.8, -5.1, materials.flowerWhite);

const station = new THREE.Group();
station.add(box(2.15, .10, 1.2, materials.white, 0, .04, 0, .04));
station.add(box(1.65, .74, .83, materials.station, 0, .46, 0, .05));
station.add(box(1.88, .18, 1.04, materials.stationRoof, 0, .91, 0, .07));
station.add(box(.28, .48, .025, materials.door, .45, .34, .43, .02));
station.add(box(.37, .25, .025, materials.windowLight, -.43, .52, .43, .015));
station.add(box(.37, .25, .025, materials.windowLight, .02, .52, .43, .015));
const signCanvas = document.createElement('canvas'); signCanvas.width = 256; signCanvas.height = 64;
const signContext = signCanvas.getContext('2d'); signContext.fillStyle = '#fffdf2'; signContext.fillRect(0, 0, 256, 64); signContext.fillStyle = '#658d7d'; signContext.font = 'bold 26px sans-serif'; signContext.textAlign = 'center'; signContext.fillText('STATION', 128, 42);
const signTexture = new THREE.CanvasTexture(signCanvas); signTexture.colorSpace = THREE.SRGBColorSpace;
const sign = new THREE.Mesh(new THREE.PlaneGeometry(.8, .2), new THREE.MeshBasicMaterial({ map: signTexture })); sign.position.set(-.05, .76, .435); station.add(sign);
station.position.set(0, 0, 0); scene.add(station); decor.push({ group: station, x: 0, z: 0, radius: 1.25 });

const trackLayer = new THREE.Group(), socketLayer = new THREE.Group(), previewLayer = new THREE.Group(), trainLayer = new THREE.Group();
scene.add(trackLayer, socketLayer, previewLayer, trainLayer);
const tieGeometry = new THREE.BoxGeometry(.09, .045, .83);
function ribbon(piece, width, offset, top, height, material) {
  const n = piece.turn ? 28 : 2;
  const positions = [], indices = [];
  for (let i = 0; i <= n; i++) {
    const p = samplePiece(piece, i / n), nx = -p.dz, nz = p.dx;
    for (const [lateral, y] of [[offset + width / 2, top], [offset - width / 2, top], [offset + width / 2, top - height], [offset - width / 2, top - height]]) {
      positions.push(p.x + nx * lateral, y, p.z + nz * lateral);
    }
  }
  for (let i = 0; i < n; i++) {
    const a = i * 4, b = (i + 1) * 4;
    indices.push(a, b, a + 1, a + 1, b, b + 1); // top
    indices.push(a + 2, a + 3, b + 2, a + 3, b + 3, b + 2); // bottom
    indices.push(a, a + 2, b, a + 2, b + 2, b); // side
    indices.push(a + 1, b + 1, a + 3, a + 3, b + 1, b + 3);
  }
  indices.push(0, 1, 2, 1, 3, 2);
  const end = n * 4; indices.push(end, end + 2, end + 1, end + 1, end + 2, end + 3);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices); geometry.computeVertexNormals(); geometry.userData.disposable = true;
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = material !== materials.ghost && material !== materials.ghostBad;
  mesh.receiveShadow = true;
  return mesh;
}
function makeTrack(piece, ghost = false, valid = true) {
  const group = new THREE.Group();
  group.userData.pieceId = piece.id;
  const bodyMaterial = ghost ? (valid ? materials.ghost : materials.ghostBad) : materials.rail;
  group.add(ribbon(piece, 1.05, 0, .135, .12, bodyMaterial));
  if (!ghost) {
    const n = Math.floor(pieceLength(piece) / .36);
    for (let i = 1; i < n; i++) {
      const p = samplePiece(piece, i / n);
      const tie = new THREE.Mesh(tieGeometry, materials.tie);
      tie.position.set(p.x, .155, p.z); tie.rotation.y = Math.atan2(-p.dz, p.dx); tie.receiveShadow = true; group.add(tie);
    }
    group.add(ribbon(piece, .14, -.34, .23, .10, materials.ridge));
    group.add(ribbon(piece, .14, .34, .23, .10, materials.ridge));
  }
  return group;
}
function clearGroup(group) {
  const geometries = new Set();
  while (group.children.length) {
    const child = group.children[0]; group.remove(child);
    child.traverse((node) => { if (node.geometry?.userData.disposable) geometries.add(node.geometry); });
  }
  geometries.forEach((geometry) => geometry.dispose());
}
const socketCanvas = document.createElement('canvas'); socketCanvas.width = 128; socketCanvas.height = 128;
const sx = socketCanvas.getContext('2d');
sx.shadowColor = 'rgba(51,94,73,.28)'; sx.shadowBlur = 12; sx.shadowOffsetY = 5;
sx.fillStyle = '#ffffff'; sx.beginPath(); sx.arc(64, 61, 50, 0, Math.PI * 2); sx.fill();
sx.shadowColor = 'transparent'; sx.fillStyle = '#79bba0'; sx.beginPath(); sx.arc(64, 61, 41, 0, Math.PI * 2); sx.fill();
sx.strokeStyle = '#fff'; sx.lineWidth = 9; sx.lineCap = 'round'; sx.beginPath(); sx.moveTo(45, 61); sx.lineTo(83, 61); sx.moveTo(64, 42); sx.lineTo(64, 80); sx.stroke();
const socketTexture = new THREE.CanvasTexture(socketCanvas); socketTexture.colorSpace = THREE.SRGBColorSpace;
const socketMaterial = new THREE.SpriteMaterial({ map: socketTexture, transparent: true, depthTest: false });
function rebuildTracks() {
  topo = topology(pieces);
  clearGroup(trackLayer); clearGroup(socketLayer); clearGroup(previewLayer); hoveredSocket = null;
  for (const piece of pieces) trackLayer.add(makeTrack(piece));
  for (const endpoint of topo.sockets) {
    const sprite = new THREE.Sprite(socketMaterial); sprite.position.set(endpoint.point.x * STEP, .65, endpoint.point.z * STEP);
    sprite.scale.set(.85, .85, 1); sprite.renderOrder = 10; sprite.userData.endpoint = endpoint; socketLayer.add(sprite);
  }
  for (const item of decor) {
    item.group.visible = !pieces.some((piece) => Array.from({ length: 33 }, (_, i) => samplePiece(piece, i / 32)).some((p) => Math.hypot(p.x - item.x, p.z - item.z) < item.radius + .55));
  }
  updateToolVisibility();
  updateUI();
}
function updateToolVisibility() {
  socketLayer.visible = ['straight', 'left', 'right'].includes(activeTool);
  if (!socketLayer.visible) clearGroup(previewLayer);
}
function buildCar(type, engine) {
  const group = new THREE.Group();
  const accent = type === 'mint' ? materials.mint : materials.coral;
  const length = engine && type === 'coral' ? 1.62 : 1.55;
  group.add(box(length, .55, .88, materials.cream, 0, .58, 0, .16));
  group.add(box(length - .06, .13, .90, accent, 0, .49, 0, .04));
  group.add(box(length - .10, .12, .79, materials.roof, -.02, .91, 0, .05));
  group.add(box(length - .10, .11, .78, materials.wheel, 0, .32, 0, .03));
  const wheelGeometry = new THREE.CylinderGeometry(.16, .16, .1, 12);
  wheelGeometry.userData.disposable = true;
  for (const x of [-.48, .48]) for (const z of [-.45, .45]) {
    const wheel = new THREE.Mesh(wheelGeometry, materials.wheel); wheel.rotation.x = Math.PI / 2; wheel.position.set(x, .28, z); wheel.castShadow = true; group.add(wheel);
    const hubGeometry = new THREE.CylinderGeometry(.065, .065, .107, 10); hubGeometry.userData.disposable = true;
    const hub = new THREE.Mesh(hubGeometry, materials.wheelInner); hub.rotation.x = Math.PI / 2; hub.position.set(x, .28, z); group.add(hub);
  }
  for (const z of [-.451, .451]) {
    for (const x of [-.48, -.16, .16, .48]) group.add(box(.23, .20, .018, materials.window, x, .72, z, .025));
    group.add(box(.025, .25, .022, materials.mintDark, -.01, .69, z * 1.002, .01));
  }
  if (engine) {
    group.add(box(.027, .25, .58, materials.window, length / 2 + .006, .70, 0, .035));
    for (const z of [-.29, .29]) group.add(box(.035, .075, .10, materials.flowerYellow, length / 2 + .025, .43, z, .015));
    if (type === 'coral') {
      const noseGeometry = new THREE.SphereGeometry(.42, 16, 12); noseGeometry.userData.disposable = true;
      const nose = new THREE.Mesh(noseGeometry, materials.cream);
      nose.scale.set(1.1, .55, 1); nose.position.set(.70, .50, 0); nose.castShadow = true; group.add(nose);
      group.add(box(.35, .10, .86, accent, .73, .43, 0, .04));
      group.add(box(.27, .12, .55, materials.window, .82, .65, 0, .04));
    }
  } else {
    group.add(box(.1, .06, .1, materials.wheel, .82, .36, 0, .02));
  }
  return group;
}
let trainCars = [];
function buildTrain() {
  clearGroup(trainLayer); trainCars = [];
  if (!train) return;
  const first = buildCar(train.type, true), second = buildCar(train.type, false);
  trainCars = [first, second]; trainLayer.add(first, second);
  updateTrainPosition();
}
function updateTrainPosition() {
  if (!train) return;
  trainCars.forEach((car, index) => {
    const position = index ? advancePosition(train, -1.78, pieces, topo) : train;
    const piece = pieces.find((p) => p.id === position.pieceId);
    if (!piece || (index && position.hitEnd)) { car.visible = false; return; }
    car.visible = true;
    const p = samplePiece(piece, position.t);
    car.position.set(p.x, 0, p.z);
    car.rotation.y = Math.atan2(-p.dz, p.dx) + (position.forward ? 0 : Math.PI);
  });
}
function selectTool(tool) {
  if (!TOOLS.includes(tool)) return;
  activeTool = tool;
  clearGroup(previewLayer); hoveredSocket = null;
  updateToolVisibility(); updateUI();
}
function updateUI() {
  for (const button of document.querySelectorAll('[data-tool]')) {
    const isSelected = button.dataset.tool === activeTool;
    button.classList.toggle('selected', isSelected); button.setAttribute('aria-pressed', String(isSelected));
  }
  $('#piece-count').textContent = pieces.length;
  const closed = topo.sockets.length === 0 && pieces.length > 1;
  $('#course-status').textContent = closed ? 'つながってる！' : `あと ${topo.sockets.length} かしょ`;
  $('#course-status').style.color = closed ? '#6eab8d' : '#d5a467';
  $('#undo-button').disabled = history.length === 0;
  $('#play-button').disabled = !train;
  $('#reverse-button').disabled = !train;
  $('#play-button').innerHTML = running ? '<span class="play-icon">❚❚</span><span>ストップ</span>' : '<span class="play-icon">▶</span><span>しゅっぱつ！</span>';
  $('#run-caption').textContent = running ? `${TRAIN_NAMES[train.type]}が走っているよ` : train ? `${TRAIN_NAMES[train.type]}、出発のじゅんびOK` : 'でんしゃをレールにおいてね';
  let icon = '✦', tip = '';
  if (activeTool === 'erase') { icon = '⌫'; tip = 'はずしたいレールをクリックしてね'; }
  else if (activeTool.startsWith('train-')) { icon = '🚃'; tip = `${TRAIN_NAMES[activeTool.slice(6)]}をおきたいレールをクリック`; }
  else if (closed) { tip = 'ループが完成！「レールをけす」で組みかえてみよう'; }
  else { icon = '＋'; tip = 'レールの先にある「＋」をクリックしてつなごう'; }
  $('#tip-icon').textContent = icon; $('#tip-text').textContent = tip;
}
function pause() { if (running) { running = false; save(); updateUI(); } }
function addAt(socket) {
  if (pieces.length >= 80) { message('レールは80こまでつなげられるよ'); return; }
  const turn = activeTool === 'left' ? -1 : activeTool === 'right' ? 1 : 0;
  const candidate = pieceFromSocket(nextId, socket, turn);
  const result = canPlace(candidate, pieces, socket);
  if (!result.ok) { message(result.reason); return; }
  pause(); remember(); nextId++; pieces.push(candidate); rebuildTracks(); save();
  if (!topo.sockets.length) message('やった！レールが一周つながったよ！');
}
function removePiece(id) {
  if (pieces.length <= 1) { message('レールはひとつ残しておいてね'); return; }
  pause(); remember(); pieces = pieces.filter((piece) => piece.id !== id);
  if (train?.pieceId === id) { train = null; buildTrain(); message('でんしゃをもう一度レールにおいてね'); }
  rebuildTracks(); save();
}
function placeTrain(id, point) {
  const piece = pieces.find((p) => p.id === id); if (!piece) return;
  let nearest = 0, min = Infinity;
  for (let i = 0; i <= 100; i++) {
    const p = samplePiece(piece, i / 100), d = Math.hypot(p.x - point.x, p.z - point.z);
    if (d < min) { min = d; nearest = i / 100; }
  }
  pause(); remember(); train = { type: activeTool.slice(6), pieceId: id, t: nearest, forward: true };
  buildTrain(); updateUI(); save(); message(`${TRAIN_NAMES[train.type]}をおいたよ！`);
}
function undo() {
  if (!history.length) return;
  pause(); const previous = JSON.parse(history.pop()); pieces = previous.pieces; train = previous.train; nextId = previous.nextId;
  rebuildTracks(); buildTrain(); save(); message('ひとつ前にもどしたよ');
}
function resetCourse() {
  pause(); remember(); pieces = [makePiece(nextId++, { x: -1, z: 0 }, { x: 1, z: 0 }, 0)]; train = null; activeTool = 'straight';
  rebuildTracks(); buildTrain(); save(); message('まっすぐなレールから、つくってみよう！');
}
function togglePlay() {
  if (!train) return;
  running = !running; updateUI(); save();
}
function reverseTrain() {
  if (!train) return;
  pause(); remember(); train.forward = !train.forward; updateTrainPosition(); updateUI(); save(); message('でんしゃの向きをかえたよ');
}
for (const button of document.querySelectorAll('[data-tool]')) button.addEventListener('click', () => selectTool(button.dataset.tool));
$('#play-button').addEventListener('click', togglePlay);
$('#reverse-button').addEventListener('click', reverseTrain);
$('#undo-button').addEventListener('click', undo);
$('#reset-button').addEventListener('click', resetCourse);
const helpDialog = $('#help-dialog');
$('#help-button').addEventListener('click', () => helpDialog.showModal());
$('#close-help').addEventListener('click', () => helpDialog.close());
$('#start-help').addEventListener('click', () => helpDialog.close());
helpDialog.addEventListener('click', (event) => { if (event.target === helpDialog) helpDialog.close(); });

const raycaster = new THREE.Raycaster(), pointer = new THREE.Vector2();
function setPointer(event) {
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
}
function socketHit(event) {
  if (!socketLayer.visible) return null;
  setPointer(event); return raycaster.intersectObjects(socketLayer.children, false)[0]?.object.userData.endpoint || null;
}
function trackHit(event) {
  setPointer(event); const hit = raycaster.intersectObjects(trackLayer.children, true)[0];
  if (!hit) return null;
  let object = hit.object; while (object && object.userData.pieceId === undefined) object = object.parent;
  return object ? { id: object.userData.pieceId, point: hit.point } : null;
}
let downPoint = null;
renderer.domElement.addEventListener('pointerdown', (event) => { downPoint = { x: event.clientX, y: event.clientY }; });
renderer.domElement.addEventListener('pointerup', (event) => {
  if (!downPoint || Math.hypot(event.clientX - downPoint.x, event.clientY - downPoint.y) > 6) { downPoint = null; return; }
  downPoint = null;
  if (['straight', 'left', 'right'].includes(activeTool)) {
    const socket = socketHit(event);
    if (socket) addAt(socket);
    else if (!topo.sockets.length) message('「レールをけす」でコースを組みかえられるよ');
  } else {
    const hit = trackHit(event);
    if (hit && activeTool === 'erase') removePiece(hit.id);
    else if (hit && activeTool.startsWith('train-')) placeTrain(hit.id, hit.point);
  }
});
renderer.domElement.addEventListener('pointermove', (event) => {
  if (event.pointerType === 'touch' || downPoint) return;
  if (['straight', 'left', 'right'].includes(activeTool)) {
    const socket = socketHit(event);
    const key = socket ? `${socket.pieceId}:${socket.index}` : null;
    if (key !== hoveredSocket) {
      hoveredSocket = key; clearGroup(previewLayer);
      if (socket) {
        const turn = activeTool === 'left' ? -1 : activeTool === 'right' ? 1 : 0;
        const candidate = pieceFromSocket(nextId, socket, turn);
        previewLayer.add(makeTrack(candidate, true, canPlace(candidate, pieces, socket).ok));
      }
    }
    renderer.domElement.style.cursor = socket ? 'pointer' : 'grab';
  } else renderer.domElement.style.cursor = trackHit(event) ? 'pointer' : 'grab';
});
renderer.domElement.addEventListener('pointerleave', () => { clearGroup(previewLayer); hoveredSocket = null; });

function resize() {
  const width = sceneElement.clientWidth, height = sceneElement.clientHeight;
  if (!width || !height) return;
  const aspect = width / height;
  const viewHeight = aspect < .9 ? 19.5 : 17.8;
  camera.left = -viewHeight * aspect / 2; camera.right = viewHeight * aspect / 2;
  camera.top = viewHeight / 2; camera.bottom = -viewHeight / 2;
  camera.updateProjectionMatrix(); renderer.setSize(width, height, false);
}
new ResizeObserver(resize).observe(sceneElement);
resize(); rebuildTracks(); buildTrain();
let lastTime = performance.now();
function animate(now) {
  const dt = Math.min((now - lastTime) / 1000, .05); lastTime = now;
  if (running && train) {
    const result = advancePosition(train, dt * 1.8, pieces, topo);
    train.pieceId = result.pieceId; train.t = result.t; train.forward = result.forward;
    updateTrainPosition();
    if (result.hitEnd) { running = false; save(); updateUI(); message('レールの端で止まったよ。向きをかえるか、レールをつなごう'); }
  }
  for (const sprite of socketLayer.children) sprite.position.y = .65 + Math.sin(now * .003 + sprite.position.x) * .07;
  controls.update(); renderer.render(scene, camera); requestAnimationFrame(animate);
}
requestAnimationFrame(animate);

// Read-only helpers for browser integration checks; omitted in normal play.
if (new URLSearchParams(location.search).has('test')) {
  function project(x, y, z) {
    const v = new THREE.Vector3(x, y, z).project(camera), rect = renderer.domElement.getBoundingClientRect();
    return { x: rect.left + (v.x + 1) * rect.width / 2, y: rect.top + (1 - v.y) * rect.height / 2 };
  }
  window.__railwayTest = {
    state: () => ({ pieces: structuredClone(pieces), train: train && { ...train }, sockets: structuredClone(topo.sockets), running, activeTool }),
    piecePoint: (id, t = .5) => { const p = samplePiece(pieces.find((piece) => piece.id === id), t); return project(p.x, .23, p.z); },
    socketPoint: (index = 0) => { const s = socketLayer.children[index]; return project(s.position.x, s.position.y, s.position.z); },
  };
}
