import { describe, expect, it } from 'vitest';
import { BASE_MAINNET, BASE_SEPOLIA } from './assets.js';
import { chainFromCaip2, isSupportedCaip2, parseCaip2, toCaip2 } from './caip.js';

describe('toCaip2', () => {
  it('renders the registered chains', () => {
    expect(toCaip2(BASE_SEPOLIA.id)).toBe('eip155:84532');
    expect(toCaip2(BASE_MAINNET.id)).toBe('eip155:8453');
  });

  it('round-trips through chainFromCaip2', () => {
    for (const chain of [BASE_MAINNET, BASE_SEPOLIA]) {
      expect(chainFromCaip2(toCaip2(chain.id))?.id).toBe(chain.id);
    }
  });
});

describe('chainFromCaip2', () => {
  it('resolves supported chains', () => {
    expect(chainFromCaip2('eip155:84532')?.slug).toBe('base-sepolia');
    expect(chainFromCaip2('eip155:8453')?.slug).toBe('base');
  });

  it('tolerates surrounding whitespace', () => {
    expect(chainFromCaip2('  eip155:84532  ')?.id).toBe(84532);
  });

  const rejected: ReadonlyArray<[string, string]> = [
    ['eip155:1', 'unregistered chain'],
    ['eip155:999999', 'unregistered chain'],
    ['solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp', 'another namespace'],
    ['84532', 'no namespace'],
    ['eip155:', 'empty reference'],
    [':84532', 'empty namespace'],
    ['eip155:84532:extra', 'trailing segment'],
    ['EIP155:84532', 'uppercase namespace'],
    ['eip155:0x14a34', 'hex reference'],
    ['', 'empty'],
  ];

  it.each(rejected)('rejects %j (%s)', (value) => {
    expect(chainFromCaip2(value)).toBeUndefined();
    expect(isSupportedCaip2(value)).toBe(false);
  });

  it('refuses a leading-zero reference rather than normalising it', () => {
    /*
     * If "eip155:084532" resolved, a string comparison of the network and a
     * numeric comparison of the chain could disagree — which is exactly the
     * gap a network-confusion attack needs.
     */
    expect(chainFromCaip2('eip155:084532')).toBeUndefined();
    expect(chainFromCaip2('eip155:+84532')).toBeUndefined();
  });
});

describe('parseCaip2', () => {
  it('splits without interpreting', () => {
    expect(parseCaip2('eip155:84532')).toEqual({ namespace: 'eip155', reference: '84532' });
  });

  it('returns null on malformed input', () => {
    expect(parseCaip2('nope')).toBeNull();
  });
});
