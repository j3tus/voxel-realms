// Cross-world party registry: friends who walk into a lobby portal together. Keyed by player uid; lives for the server's lifetime.
const MAX = 8;
export class Parties {
  constructor() { this.by = new Map(); this.inv = new Map(); }
  get(uid) { return this.by.get(uid) || null; }
  create(uid) { let p = this.by.get(uid); if (!p) { p = { leader: uid, members: new Set([uid]) }; this.by.set(uid, p); } return p; }
  /** returns an error string, or null on success */
  invite(from, to) {
    const own = this.by.get(from); if (own && own.leader !== from) return 'Only the party leader can invite.';
    const p = this.create(from); if (p.members.size >= MAX) return 'Your party is full.'; if (p.members.has(to)) return 'They are already in your party.';
    this.inv.set(to, { from, at: Date.now() }); return null;
  }
  /** returns the party, or an error string */
  accept(uid) {
    const i = this.inv.get(uid); if (!i || Date.now() - i.at > 120000) return 'You have no pending party invite.';
    const p = this.by.get(i.from); if (!p) { this.inv.delete(uid); return 'That party no longer exists.'; } if (p.members.size >= MAX) return 'That party is full.';
    this.leave(uid); p.members.add(uid); this.by.set(uid, p); this.inv.delete(uid); return p;
  }
  leave(uid) {
    const p = this.by.get(uid); if (!p) return; p.members.delete(uid); this.by.delete(uid);
    if (p.members.size <= 1) { for (const m of p.members) this.by.delete(m); p.members.clear(); } else if (p.leader === uid) p.leader = [...p.members][0];
  }
}
