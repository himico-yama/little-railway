import test from 'node:test';
import assert from 'node:assert/strict';
import { makePiece, pieceFromSocket, topology, canPlace, demoPieces, advancePosition, pieceLength, samplePiece } from '../src/track.js';

test('the example course closes smoothly and can be assembled piece by piece', () => {
  const demo = demoPieces();
  assert.equal(demo.length, 8);
  const built = [demo[0]];
  for (const piece of demo.slice(1)) {
    const socket = topology(built).sockets.find((s) => s.pieceId === built.at(-1).id && s.index === 1);
    const candidate = pieceFromSocket(piece.id, socket, piece.turn);
    assert.deepEqual(candidate, piece);
    assert.deepEqual(canPlace(candidate, built, socket), { ok: true });
    built.push(candidate);
  }
  assert.equal(topology(built).sockets.length, 0);
});

test('a train follows an entire loop in either direction', () => {
  const pieces = demoPieces();
  const total = pieces.reduce((sum, piece) => sum + pieceLength(piece), 0);
  const start = { pieceId: 1, t: .37, forward: true };
  for (const distance of [total, -total, total * 2]) {
    const result = advancePosition(start, distance, pieces);
    assert.equal(result.hitEnd, false);
    assert.equal(result.pieceId, start.pieceId);
    assert.equal(result.forward, start.forward);
    assert.ok(Math.abs(result.t - start.t) < 1e-7);
  }
});

test('a train stops at a disconnected end and can reverse', () => {
  const pieces = [makePiece(1, { x: 0, z: 0 }, { x: 1, z: 0 })];
  const stopped = advancePosition({ pieceId: 1, t: .5, forward: true }, 5, pieces);
  assert.equal(stopped.hitEnd, true);
  assert.equal(stopped.t, 1);
  const reversed = advancePosition({ ...stopped, forward: false }, 1, pieces);
  assert.equal(reversed.hitEnd, false);
  assert.ok(reversed.t < 1);
});

test('piece direction stays continuous across a curve', () => {
  const piece = makePiece(1, { x: 0, z: 0 }, { x: 1, z: 0 }, 1);
  const start = samplePiece(piece, 0), end = samplePiece(piece, 1);
  assert.ok(Math.abs(start.dx - 1) < 1e-8 && Math.abs(start.dz) < 1e-8);
  assert.ok(Math.abs(end.dx) < 1e-8 && Math.abs(end.dz - 1) < 1e-8);
});
