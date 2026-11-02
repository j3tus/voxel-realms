// Strict validation of every client -> server game message.
import { z } from 'zod';

const int = z.number().int();
export const HelloMsg = z.object({
  t: z.literal('hello'), name: z.string().max(40).optional(), uid: z.string().max(64).optional(), password: z.string().max(100).optional(),
  v: z.number().optional(), q: z.number().optional(), skin: z.object({ shirt: z.string().max(9).nullish(), pants: z.string().max(9).nullish(), skin: z.string().max(9).nullish(), hair: z.string().max(9).nullish() }).partial().nullish(),
});
const Pos = z.object({ t: z.literal('pos'), x: z.number(), y: z.number(), z: z.number(), yaw: z.number().optional(), pitch: z.number().optional(), st: z.number().optional() });
export const GameMsg = z.discriminatedUnion('t', [
  Pos,
  z.object({ t: z.literal('block'), x: int, y: int, z: int, id: int.min(0).max(40) }),
  z.object({ t: z.literal('chat'), text: z.string().max(240) }),
  z.object({ t: z.literal('ping'), ts: z.number() }),
  z.object({ t: z.literal('hit'), id: int, dmg: z.number().optional() }),
  z.object({ t: z.literal('trade'), action: z.enum(['buy', 'sell']), id: int.min(1).max(40), n: int.min(1).max(64) }),
  z.object({ t: z.literal('bounty'), uid: z.string().max(16) }),
  z.object({ t: z.literal('craft'), r: int.min(0).max(64) }),
  z.object({ t: z.literal('respawn') }),
  z.object({ t: z.literal('shoot'), w: int.min(0).max(7), dx: z.number().finite(), dy: z.number().finite(), dz: z.number().finite() }),
  z.object({ t: z.literal('reload'), w: int.min(0).max(7) }),
]);
export function parseGame(raw) {
  let obj; try { obj = JSON.parse(raw); } catch { return null; }
  if (!obj || typeof obj !== 'object') return null;
  if (obj.t === 'pos' && Number.isFinite(obj.x) && Number.isFinite(obj.y) && Number.isFinite(obj.z)) return obj; // hot path: cheap check only
  const r = GameMsg.safeParse(obj); return r.success ? r.data : null;
}
