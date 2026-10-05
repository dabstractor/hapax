import { describe, expect, it } from 'vitest';
import type {
  RankGroup, Candidate, Sighting, GateRejectReason, GateResult,
  Dictionary, IngestStats, RankedMatch, CasingClass,
} from '../src/core/types.js';

describe('core type contracts', () => {
  it('exports the documented vocabulary', () => {
    // Type-level usage only; runtime assertions on values that must type-check.
    const candidate: Candidate = {
      key: 'nrel', display: 'NREL', sessionCount: 1,
      lastSeenOrdinal: 0, firstSeenOrdinal: 0, userTyped: false,
      properName: true, rankGroup: 0 ,
      capCount: 1, lowerCount: 0, capDisplay: 'NREL',
    };
    expect(candidate.rankGroup satisfies RankGroup).toBe(0);

    const gate: GateResult = { ok: false, reason: 'secret' };
    expect(gate.reason satisfies GateRejectReason | undefined).toBe('secret');

    const match: RankedMatch = { key: 'nrel', display: 'NREL',
      description: 'session ×1', salience: 4.3, sessionCount: 1 };
    expect(match.key).toBe('nrel');

    const stats: IngestStats = {
      wordsSeen: 0, admitted: 0,
      rejectedByGate: { tooShort: 0, tooLong: 0, lowEntropy: 0, unigramRun: 0,
                        secret: 0, consonantRun: 0 },
    };
    expect(Object.keys(stats.rejectedByGate)).toHaveLength(6);

    const dict: Dictionary = { lookup: () => null, version: 1, entryCount: 0 };
    expect(dict.lookup('x')).toBeNull();

    const s: Sighting = { key: 'nrel', display: 'NREL', ordinal: 1,
      fromUser: true, properName: true, casing: 'mid-cap', rankGroup: 0 };
    expect(s.rankGroup).toBe(0);
    expect(s.casing).toBe('mid-cap');
    expect('lower' satisfies CasingClass).toBe('lower');
    expect('structural-cap' satisfies CasingClass).toBe('structural-cap');
  });
});