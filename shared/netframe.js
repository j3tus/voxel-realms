// Compact binary state frame (type 4). Positions are int16 fixed-point (1/32 block) relative to a coarse per-frame anchor,
// which cuts each entity from 19 to 13 bytes versus the float32 frame (type 3, still sent to older clients).
//   [4][i32 ax][i32 az][u16 nPlayers]{u16 id,i16 dx,i16 y,i16 dz,i16 yaw,i16 pitch,u8 st}[u16 nMobs]{u16 id,u8 type,i16 dx,i16 y,i16 dz,i16 yaw,u8 hp,u8 flags}
export const NF_SCALE = 32, NF_ANCHOR = 64, NF_ENTITY = 13, NF_HEADER = 11;
const q = v => Math.max(-32768, Math.min(32767, Math.round(v * NF_SCALE)));
export const anchorOf = v => Math.floor(v / NF_ANCHOR) * NF_ANCHOR;

/** players: [{id,x,y,z,yaw,pitch,st}] (yaw/pitch already as int16 milli-radians via `ang`), mobs: [{id,type,x,y,z,yaw,hp,flags}] */
export function encodeState(cx, cz, players, mobs) {
  const ax = anchorOf(cx), az = anchorOf(cz), buf = Buffer.allocUnsafe(NF_HEADER + 2 + (players.length + mobs.length) * NF_ENTITY); let o = 0;
  buf[o++] = 4; buf.writeInt32LE(ax, o); buf.writeInt32LE(az, o + 4); o += 8; buf.writeUInt16LE(players.length, o); o += 2;
  for (const e of players) { buf.writeUInt16LE(e.id, o); buf.writeInt16LE(q(e.x - ax), o + 2); buf.writeInt16LE(q(e.y), o + 4); buf.writeInt16LE(q(e.z - az), o + 6); buf.writeInt16LE(e.yaw, o + 8); buf.writeInt16LE(e.pitch, o + 10); buf[o + 12] = e.st; o += NF_ENTITY; }
  buf.writeUInt16LE(mobs.length, o); o += 2;
  for (const e of mobs) { buf.writeUInt16LE(e.id, o); buf[o + 2] = e.type; buf.writeInt16LE(q(e.x - ax), o + 3); buf.writeInt16LE(q(e.y), o + 5); buf.writeInt16LE(q(e.z - az), o + 7); buf.writeInt16LE(e.yaw, o + 9); buf[o + 11] = e.hp; buf[o + 12] = e.flags; o += NF_ENTITY; }
  return buf;
}

/** DataView -> { players:[{id,x,y,z,yaw,pitch,st}], mobs:[{id,type,x,y,z,yaw,hp,flags}] } (yaw/pitch in radians) */
export function decodeState(dv) {
  const ax = dv.getInt32(1, true), az = dv.getInt32(5, true), players = [], mobs = []; let o = 9;
  const np = dv.getUint16(o, true); o += 2;
  for (let i = 0; i < np; i++, o += NF_ENTITY) players.push({ id: dv.getUint16(o, true), x: ax + dv.getInt16(o + 2, true) / NF_SCALE, y: dv.getInt16(o + 4, true) / NF_SCALE, z: az + dv.getInt16(o + 6, true) / NF_SCALE, yaw: dv.getInt16(o + 8, true) / 1000, pitch: dv.getInt16(o + 10, true) / 1000, st: dv.getUint8(o + 12) });
  const nm = dv.getUint16(o, true); o += 2;
  for (let i = 0; i < nm; i++, o += NF_ENTITY) mobs.push({ id: dv.getUint16(o, true), type: dv.getUint8(o + 2), x: ax + dv.getInt16(o + 3, true) / NF_SCALE, y: dv.getInt16(o + 5, true) / NF_SCALE, z: az + dv.getInt16(o + 7, true) / NF_SCALE, yaw: dv.getInt16(o + 9, true) / 1000, hp: dv.getUint8(o + 11), flags: dv.getUint8(o + 12) });
  return { players, mobs };
}
