import { describe, it, expect } from 'vitest';
import { MISSIONS, newCareer, progress, rankOf, current } from '../shared/career.js';
import { B } from '../shared/blocks.js';

describe('career missions', () => {
  it('completes a collect mission and advances with a reward', () => {
    const c = newCareer(); for (let i = 0; i < 4; i++) expect(progress(c, { kind: 'collect', of: B.LOG }).done).toBeNull();
    const r = progress(c, { kind: 'collect', of: B.LOG }); expect(r.done).toBe(MISSIONS[0]); expect(c.step).toBe(1); expect(c.prog).toBe(0); expect(c.total).toBe(MISSIONS[0].reward);
  });
  it('ignores events of the wrong kind or item, and counts grass as dirt', () => {
    const c = newCareer(); progress(c, { kind: 'kill', of: 'pig' }); progress(c, { kind: 'collect', of: B.STONE }); expect(c.prog).toBe(0);
    c.step = 1; progress(c, { kind: 'collect', of: B.GRASS, n: 10 }); expect(c.step).toBe(2);
  });
  it('ranks increase and the ladder ends cleanly', () => {
    const c = newCareer(); expect(rankOf(c)).toBe('Drifter'); c.step = 12; expect(current(c)).toBeNull(); expect(rankOf(c)).toBe('Tycoon');
    expect(progress(c, { kind: 'collect', of: B.LOG }).done).toBeNull();
  });
});
