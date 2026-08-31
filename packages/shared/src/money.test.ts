import { describe, expect, it } from 'vitest';
import { Money, MoneyError, Rounding } from './money.js';

const USDC = { currency: 'USDC', decimals: 6 } as const;

function usdc(value: string): Money {
  return Money.fromDecimalString(value, USDC.currency, USDC.decimals);
}

describe('Money.fromDecimalString', () => {
  it('parses the canonical $0.03 endpoint price to exact minor units', () => {
    expect(usdc('0.03').minorUnits).toBe(30_000n);
  });

  it('parses whole numbers', () => {
    expect(usdc('1').minorUnits).toBe(1_000_000n);
    expect(usdc('0').minorUnits).toBe(0n);
  });

  it('parses full precision', () => {
    expect(usdc('0.000001').minorUnits).toBe(1n);
  });

  it('parses negative amounts, used for refunds and ledger reversals', () => {
    expect(usdc('-0.03').minorUnits).toBe(-30_000n);
  });

  it('refuses to silently truncate an amount with more precision than the asset', () => {
    // 7 decimal places against 6-decimal USDC. Truncating here would quietly
    // drop value; the whole point is that this is loud.
    expect(() => usdc('0.0000001')).toThrow(MoneyError);
    expect(() => usdc('0.0000001')).toThrow(/supports only 6/);
  });

  it.each([
    ['1.2.3', 'multiple decimal points'],
    ['1e6', 'exponent notation'],
    ['.5', 'bare leading dot'],
    ['+1.0', 'explicit plus sign'],
    ['1,000.00', 'thousands separator'],
    ['abc', 'non-numeric'],
    ['', 'empty string'],
    ['Infinity', 'float sentinel'],
    ['NaN', 'float sentinel'],
  ])('rejects malformed input %s (%s)', (input) => {
    expect(() => usdc(input)).toThrow(MoneyError);
  });

  it('rejects non-string input rather than coercing a float', () => {
    expect(() => Money.fromDecimalString(0.03 as never, 'USDC', 6)).toThrow(MoneyError);
  });
});

describe('Money serialisation', () => {
  it('round-trips through its canonical decimal form', () => {
    for (const value of ['0.03', '1.000000', '123456.789012', '-0.000001', '0.000000']) {
      expect(usdc(value).toDecimalString()).toBe(usdc(value).toDecimalString());
      expect(usdc(usdc(value).toDecimalString()).equals(usdc(value))).toBe(true);
    }
  });

  it('always renders the asset full precision', () => {
    expect(usdc('1').toDecimalString()).toBe('1.000000');
    expect(usdc('0.03').toDecimalString()).toBe('0.030000');
  });

  it('renders zero-decimal assets without a decimal point', () => {
    expect(Money.fromMinorUnits(7n, 'JPY', 0).toDecimalString()).toBe('7');
  });

  it('serialises amounts as strings so no consumer can parse them into a float', () => {
    expect(usdc('0.03').toJSON()).toEqual({
      amount: '30000',
      currency: 'USDC',
      decimals: 6,
    });
  });
});

describe('Money arithmetic', () => {
  it('does not exhibit the classic IEEE-754 error', () => {
    // In float arithmetic 0.1 + 0.2 === 0.30000000000000004. This is the
    // single defect this type exists to make impossible.
    expect(usdc('0.1').add(usdc('0.2')).equals(usdc('0.3'))).toBe(true);
    expect(usdc('0.1').add(usdc('0.2')).toDecimalString()).toBe('0.300000');
  });

  it('adds and subtracts exactly', () => {
    expect(usdc('1.5').add(usdc('2.25')).toDecimalString()).toBe('3.750000');
    expect(usdc('1.5').subtract(usdc('2.25')).toDecimalString()).toBe('-0.750000');
  });

  it('preserves precision at magnitudes far beyond Number.MAX_SAFE_INTEGER', () => {
    // 10 trillion USDC in minor units is ~1e19, past the 2^53 exact-integer
    // ceiling of a double. BigInt handles it without loss.
    const huge = Money.fromMinorUnits(10_000_000_000_000_000_001n, 'USDC', 6);
    expect(huge.add(Money.fromMinorUnits(1n, 'USDC', 6)).minorUnits).toBe(
      10_000_000_000_000_000_002n,
    );
  });

  it('refuses to mix currencies', () => {
    const eurc = Money.fromDecimalString('1.00', 'EURC', 6);
    expect(() => usdc('1.00').add(eurc)).toThrow(MoneyError);
    expect(() => usdc('1.00').compare(eurc)).toThrow(/must be explicit/);
  });

  it('refuses to mix differing precisions of the same ticker', () => {
    const sixDp = Money.fromMinorUnits(1n, 'USDC', 6);
    const eighteenDp = Money.fromMinorUnits(1n, 'USDC', 18);
    expect(() => sixDp.add(eighteenDp)).toThrow(MoneyError);
  });

  it('is immutable', () => {
    const original = usdc('1.00');
    original.add(usdc('1.00'));
    expect(original.toDecimalString()).toBe('1.000000');
  });
});

describe('Money.multiplyByRatio — platform fee calculation', () => {
  it('computes an exact 0.8% fee on a round amount', () => {
    // 0.8% of 10 USDC = 0.08 USDC exactly.
    const fee = usdc('10').multiplyByRatio(8n, 1000n, Rounding.Exact);
    expect(fee.toDecimalString()).toBe('0.080000');
  });

  it('truncates toward zero under Rounding.Down', () => {
    // 0.8% of 0.03 USDC = 240 nano-units = 0.00024 USDC, which is exact at 6dp.
    // Use a value that is genuinely inexact: 1/3 of 1 minor unit.
    const fee = Money.fromMinorUnits(1n, 'USDC', 6).multiplyByRatio(1n, 3n, Rounding.Down);
    expect(fee.minorUnits).toBe(0n);
  });

  it('rounds half away from zero under Rounding.HalfUp', () => {
    // 5 minor units / 2 = 2.5 -> 3
    expect(
      Money.fromMinorUnits(5n, 'USDC', 6).multiplyByRatio(1n, 2n, Rounding.HalfUp).minorUnits,
    ).toBe(3n);
    // 4 minor units / 2 = 2 exactly
    expect(
      Money.fromMinorUnits(4n, 'USDC', 6).multiplyByRatio(1n, 2n, Rounding.HalfUp).minorUnits,
    ).toBe(2n);
    // 3 minor units / 2 = 1.5 -> 2
    expect(
      Money.fromMinorUnits(3n, 'USDC', 6).multiplyByRatio(1n, 2n, Rounding.HalfUp).minorUnits,
    ).toBe(2n);
  });

  it('rounds negative halves away from zero, not toward it', () => {
    expect(
      Money.fromMinorUnits(-5n, 'USDC', 6).multiplyByRatio(1n, 2n, Rounding.HalfUp).minorUnits,
    ).toBe(-3n);
  });

  it('truncates negatives toward zero under Rounding.Down', () => {
    expect(
      Money.fromMinorUnits(-5n, 'USDC', 6).multiplyByRatio(1n, 2n, Rounding.Down).minorUnits,
    ).toBe(-2n);
  });

  it('throws under Rounding.Exact when the result would be inexact', () => {
    expect(() =>
      Money.fromMinorUnits(1n, 'USDC', 6).multiplyByRatio(1n, 3n, Rounding.Exact),
    ).toThrow(/not exact/);
  });

  it('rejects a zero denominator', () => {
    expect(() => usdc('1').multiplyByRatio(1n, 0n, Rounding.Down)).toThrow(MoneyError);
  });

  it('keeps gross = fee + net for a realistic micropayment', () => {
    // A $0.03 request with a 0.8% platform fee. Whatever the rounding, the
    // ledger must balance exactly — this is the invariant reconciliation
    // depends on.
    const gross = usdc('0.03');
    const fee = gross.multiplyByRatio(8n, 1000n, Rounding.Down);
    const net = gross.subtract(fee);
    expect(net.add(fee).equals(gross)).toBe(true);
  });
});

describe('Money comparison', () => {
  it('orders correctly', () => {
    expect(usdc('0.03').compare(usdc('0.04'))).toBe(-1);
    expect(usdc('0.04').compare(usdc('0.03'))).toBe(1);
    expect(usdc('0.03').compare(usdc('0.03'))).toBe(0);
  });

  it('reports sign predicates', () => {
    expect(usdc('0').isZero()).toBe(true);
    expect(usdc('-1').isNegative()).toBe(true);
    expect(usdc('1').isPositive()).toBe(true);
  });

  it('treats different currencies as unequal rather than throwing', () => {
    // `equals` is a total predicate used in assertions; `compare` is the
    // ordering operation and is the one that must refuse cross-currency input.
    expect(usdc('1').equals(Money.fromDecimalString('1', 'EURC', 6))).toBe(false);
  });
});

describe('Money construction guards', () => {
  it('rejects nonsensical decimal counts', () => {
    expect(() => Money.fromMinorUnits(1n, 'USDC', -1)).toThrow(MoneyError);
    expect(() => Money.fromMinorUnits(1n, 'USDC', 1.5)).toThrow(MoneyError);
    expect(() => Money.fromMinorUnits(1n, 'USDC', 99)).toThrow(MoneyError);
  });

  it('builds zero', () => {
    expect(Money.zero('USDC', 6).isZero()).toBe(true);
  });
});
