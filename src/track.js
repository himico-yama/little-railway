// The endpoints live on an integer grid. A curve is one exact quarter circle,
// so independently assembled pieces can meet without accumulating rounding errors.
export const STEP = 2.5;
export const BOARD_X = 8.9;
export const BOARD_Z = 6.9;

export function makePiece(id, start, dir, turn = 0) {
  return { id, start: { ...start }, dir: { ...dir }, turn };
}

export function pieceEnd(piece) {
  const { start, dir, turn } = piece;
  if (!turn) return { x: start.x + dir.x, z: start.z + dir.z };
  const side = { x: -dir.z * turn, z: dir.x * turn };
  return { x: start.x + dir.x + side.x, z: start.z + dir.z + side.z };
}

export function endDirection(piece) {
  return piece.turn ? { x: -piece.dir.z * piece.turn, z: piece.dir.x * piece.turn } : { ...piece.dir };
}

export function endpointsFor(piece) {
  return [
    { pieceId: piece.id, index: 0, point: { ...piece.start }, out: { x: -piece.dir.x, z: -piece.dir.z } },
    { pieceId: piece.id, index: 1, point: pieceEnd(piece), out: endDirection(piece) },
  ];
}

const endpointKey = (endpoint) => `${endpoint.pieceId}:${endpoint.index}`;
const samePoint = (a, b) => a.x === b.x && a.z === b.z;
const opposite = (a, b) => a.x === -b.x && a.z === -b.z;

export function topology(pieces) {
  const all = pieces.flatMap(endpointsFor);
  const connections = new Map();
  for (let i = 0; i < all.length; i++) {
    if (connections.has(endpointKey(all[i]))) continue;
    for (let j = i + 1; j < all.length; j++) {
      if (!connections.has(endpointKey(all[j])) && all[i].pieceId !== all[j].pieceId &&
          samePoint(all[i].point, all[j].point) && opposite(all[i].out, all[j].out)) {
        connections.set(endpointKey(all[i]), all[j]);
        connections.set(endpointKey(all[j]), all[i]);
        break;
      }
    }
  }
  return { all, connections, sockets: all.filter((endpoint) => !connections.has(endpointKey(endpoint))) };
}

export function samplePiece(piece, t) {
  const { start, dir, turn } = piece;
  if (!turn) return {
    x: (start.x + dir.x * t) * STEP,
    z: (start.z + dir.z * t) * STEP,
    dx: dir.x, dz: dir.z,
  };
  const a = t * Math.PI / 2;
  const side = { x: -dir.z * turn, z: dir.x * turn };
  return {
    x: (start.x + dir.x * Math.sin(a) + side.x * (1 - Math.cos(a))) * STEP,
    z: (start.z + dir.z * Math.sin(a) + side.z * (1 - Math.cos(a))) * STEP,
    dx: dir.x * Math.cos(a) + side.x * Math.sin(a),
    dz: dir.z * Math.cos(a) + side.z * Math.sin(a),
  };
}

export function pieceLength(piece) { return STEP * (piece.turn ? Math.PI / 2 : 1); }

export function pieceFromSocket(id, socket, turn) {
  return makePiece(id, socket.point, socket.out, turn);
}

// The board has one level: reject overlaps and crossings instead of letting
// two pieces occupy the same physical space. Matching end joints are allowed.
export function canPlace(candidate, pieces, socket) {
  const topo = topology(pieces);
  if (!topo.sockets.some((s) => endpointKey(s) === endpointKey(socket))) return { ok: false, reason: '接続できるレールの先をえらんでね' };
  const candidateEnds = endpointsFor(candidate);
  const startMatches = topo.all.filter((e) => samePoint(e.point, candidateEnds[0].point));
  if (startMatches.length !== 1 || !opposite(startMatches[0].out, candidateEnds[0].out)) return { ok: false, reason: 'ここにはつなげられません' };
  const endMatches = topo.all.filter((e) => samePoint(e.point, candidateEnds[1].point));
  if (endMatches.length && (endMatches.length !== 1 || !topo.sockets.some((s) => endpointKey(s) === endpointKey(endMatches[0])) || !opposite(endMatches[0].out, candidateEnds[1].out))) {
    return { ok: false, reason: 'レールの向きが合っていないよ' };
  }
  const samples = Array.from({ length: 33 }, (_, i) => samplePiece(candidate, i / 32));
  if (samples.some((p) => Math.abs(p.x) > BOARD_X || Math.abs(p.z) > BOARD_Z)) return { ok: false, reason: 'あそび場の中につなげてね' };
  const joints = [candidateEnds[0], ...(endMatches.length ? [candidateEnds[1]] : [])].map((e) => ({ x: e.point.x * STEP, z: e.point.z * STEP }));
  for (const existing of pieces) {
    const others = Array.from({ length: 33 }, (_, i) => samplePiece(existing, i / 32));
    for (const p of samples) for (const q of others) {
      const distance = Math.hypot(p.x - q.x, p.z - q.z);
      if (distance >= 0.68) continue;
      const atJoint = joints.some((joint) => Math.hypot(p.x - joint.x, p.z - joint.z) < 0.9 && Math.hypot(q.x - joint.x, q.z - joint.z) < 0.9);
      if (!atJoint) return { ok: false, reason: 'レールが重なってしまうよ' };
    }
  }
  return { ok: true };
}

// Move a position through any number of joints, preserving the train's facing.
// A negative distance samples behind the engine and does not change its facing.
export function advancePosition(position, distance, pieces, topo = topology(pieces)) {
  let state = { ...position };
  let remaining = Math.abs(distance);
  const positive = distance >= 0;
  let hitEnd = false;
  for (let guard = 0; remaining > 1e-8 && guard < 200; guard++) {
    const piece = pieces.find((p) => p.id === state.pieceId);
    if (!piece) return { ...state, hitEnd: true };
    const travelForward = positive ? state.forward : !state.forward;
    const len = pieceLength(piece);
    const available = (travelForward ? 1 - state.t : state.t) * len;
    if (remaining <= available + 1e-8) {
      state.t = Math.max(0, Math.min(1, state.t + (travelForward ? 1 : -1) * remaining / len));
      remaining = 0;
      break;
    }
    remaining -= available;
    const neighbor = topo.connections.get(`${piece.id}:${travelForward ? 1 : 0}`);
    if (!neighbor) {
      state.t = travelForward ? 1 : 0;
      hitEnd = true;
      break;
    }
    const nextTravelForward = neighbor.index === 0;
    state = { pieceId: neighbor.pieceId, t: nextTravelForward ? 0 : 1, forward: positive ? nextTravelForward : !nextTravelForward };
  }
  return { ...state, hitEnd };
}

export function demoPieces() {
  const pieces = [];
  let current = makePiece(1, { x: -1, z: -1 }, { x: 1, z: 0 }, 0);
  for (const [i, turn] of [0, 0, 1, 1, 0, 0, 1, 1].entries()) {
    current = makePiece(i + 1, current.start, current.dir, turn);
    pieces.push(current);
    current = makePiece(i + 2, pieceEnd(current), endDirection(current), 0);
  }
  return pieces;
}
