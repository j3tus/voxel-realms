import { describe, it, expect } from 'vitest';
import { sanitizeTuning, TUNABLE, BotDirector } from '../server/bots.js';

describe('bot tuning', () => {
  it('clamps values and drops unknown or non-numeric keys', () => {
    expect(sanitizeTuning({ react: 99, err: -5, rof: 2, evil: 1, fire: 'x', speed: null })).toEqual({ react: TUNABLE.react[1], err: 0, rof: 2 });
    expect(sanitizeTuning(null)).toEqual({});
    expect(sanitizeTuning('hi')).toEqual({});
  });
  const dir = (meta, cfg) => new BotDirector({ meta, hooks: { botsCfg: () => cfg }, players: new Map() });
  it('layers preset < global tier tuning < world tuning', () => {
    const d = dir({ botSkill: 'hard', botTuning: { react: 0.5 } }, { skill: 'normal', tuning: { hard: { react: 0.1, err: 0.05 } } });
    const p = d.profile(null);
    expect(p.react).toBe(0.5);   // world override wins
    expect(p.err).toBe(0.05);    // global tier override
    expect(p.rof).toBe(1.08);    // untouched preset value
  });
  it('a bot-specific skill beats the world skill, and bad config is ignored', () => {
    const d = dir({ botSkill: 'easy' }, { skill: 'normal', tuning: { easy: { react: 'nope', fire: 7 } } });
    expect(d.profile({ botSkill: 'hard' }).react).toBe(0.18);
    expect(d.profile(null).fire).toBe(1);
  });
});
