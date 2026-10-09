import { describe, expect, it } from 'vitest';
import { parseIdParam, findLeague, parseLeagueParam } from './apiUtils';

describe('parseIdParam', () => {
  it('accepts positive integers only', () => {
    expect(parseIdParam('47')).toBe(47);
    for (const bad of ['', '0', '-1', '12abc', '1.5', ' 7', 'NaN', null, undefined, '99999999999999999999']) {
      expect(parseIdParam(bad as string | null | undefined), String(bad)).toBeNull();
    }
  });
});

describe('league lookup', () => {
  it('resolves supported leagues and rejects unknown ones', () => {
    expect(parseLeagueParam('55')?.name).toBe('Serie A');
    expect(findLeague(999)).toBeNull();
    expect(parseLeagueParam('abc')).toBeNull();
  });
});
