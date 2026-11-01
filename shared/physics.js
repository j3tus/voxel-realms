// Shared body physics (player + NPCs, client + server) built on voxel-aabb-sweep: continuous swept-AABB collision,
// so fast bodies can never tunnel through thin walls and sliding along surfaces is exact on every axis.
import sweep from 'voxel-aabb-sweep';

const EPS = 1e-6;
const box = { base: [0, 0, 0], max: [0, 0, 0], translate(d) { for (let i = 0; i < 3; i++) { this.base[i] += d[i]; this.max[i] += d[i]; } } };
const vec = [0, 0, 0];

/**
 * Move `body` ({x,y,z feet-centre, vx,vy,vz, w,h}) by its velocity over dt.
 * `solid(x,y,z)` must return truthy for blocking voxels. Velocity components that hit something are zeroed.
 * Returns { x, y, z, ground, ceiling } flags - which axes were blocked - and sets body.onGround.
 * `sneak`: never walk off a ledge while standing on ground (the body is pulled back to the edge instead).
 */
export function moveBody(solid, body, dt, { sneak = false } = {}) {
  const hw = body.w / 2, flags = { x: false, y: false, z: false, ground: false, ceiling: false };
  const startOnGround = body.onGround;
  const px = body.x, py = body.y, pz = body.z;
  box.base[0] = body.x - hw; box.base[1] = body.y; box.base[2] = body.z - hw; box.max[0] = body.x + hw; box.max[1] = body.y + body.h; box.max[2] = body.z + hw;
  // voxel-aabb-sweep never terminates for vanishingly small (e.g. 1e-230, decayed friction) or non-finite components, so snap those to zero
  vec[0] = body.vx * dt; vec[1] = body.vy * dt; vec[2] = body.vz * dt;
  for (let i = 0; i < 3; i++) if (!(Math.abs(vec[i]) > 1e-9 && Math.abs(vec[i]) < 1e4)) vec[i] = 0;
  sweep(solid, box, vec, (dist, axis, dir, v) => {
    if (axis === 0) { flags.x = true; body.vx = 0; } else if (axis === 1) { flags.y = true; if (dir < 0) flags.ground = true; else flags.ceiling = true; body.vy = 0; } else { flags.z = true; body.vz = 0; }
    v[axis] = 0; return false;
  }, false, EPS);
  body.x = (box.base[0] + box.max[0]) / 2; body.y = box.base[1]; body.z = (box.base[2] + box.max[2]) / 2;
  body.onGround = flags.ground;
  if (sneak && startOnGround && !flags.ground && body.vy <= 0) { // would have walked off an edge: undo the horizontal move (keep it only if there is still ground under it)
    if (!hasGround(solid, body.x, body.y, body.z, hw)) { body.x = px; body.z = pz; body.y = py; body.vx = body.vz = 0; body.vy = 0; body.onGround = true; flags.ground = true; }
  }
  return flags;
}

/** Is there support within 0.2 below the feet (any corner of the footprint)? */
export function hasGround(solid, x, y, z, hw) {
  const yy = Math.floor(y - 0.2);
  for (const dx of [-hw, hw]) for (const dz of [-hw, hw]) if (solid(Math.floor(x + dx), yy, Math.floor(z + dz))) return true;
  return false;
}

/** Does the body overlap any solid voxel? (used for invariants and spawn checks) */
export function overlaps(solid, body) {
  const hw = body.w / 2;
  for (let a = Math.floor(body.x - hw + EPS); a <= Math.floor(body.x + hw - EPS); a++) for (let b = Math.floor(body.y + EPS); b <= Math.floor(body.y + body.h - EPS); b++) for (let c = Math.floor(body.z - hw + EPS); c <= Math.floor(body.z + hw - EPS); c++) if (solid(a, b, c)) return true;
  return false;
}
