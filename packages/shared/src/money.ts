/**
 * Money.
 *
 * The single most correctness-critical type in Meter402. Every monetary amount
 * in the system is an integer count of an asset's smallest indivisible unit,
 * held as a `bigint`. There is no code path anywhere in this codebase that
 * converts an amount to a JavaScript `number`.
 *
 * Why: IEEE-754 doubles cannot represent most decimal fractions. `0.1 + 0.2`
 * is `0.30000000000000004`. Applied to a payments ledger that is not a rounding
 * curiosity, it is unreconcilable money. USDC has 6 decimals, so $0.03 is
 * exactly `30000n` minor units and stays exact through every operation here.
 *
 * Design notes:
 *  - `Money` is immutable. Every operation returns a new instance.
 *  - Operations between different currencies throw rather than coerce.
 *  - Parsing rejects inputs with more precision than the asset supports,
 *    rather than silently truncating. Silently dropping a fraction of a cent
 *    is how ledgers drift.
 */

/** ISO-4217-style code for fiat, or token symbol for on-chain assets. */
export type CurrencyCode = string;

/** Rounding behaviour for operations that cannot produce an exact integer. */
export enum Rounding {
  /** Truncate toward zero. The conservative default for fees we charge. */
  Down = 'DOWN',
  /** Away from zero when the remainder is >= half. */
  HalfUp = 'HALF_UP',
  /** Reject the operation if it would not be exact. */
  Exact = 'EXACT',
}

export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MoneyError';
  }
}

/**
 * A decimal string: optional sign, digits, optional fractional part.
 * Deliberately strict — no exponent notation, no leading `+`, no whitespace
 * inside, no bare `.5`. Ambiguous money input is a bug, not a convenience.
 */
const DECIMAL_PATTERN = /^(-?)(\d+)(?:\.(\d+))?$/;

export class Money {
  /** Count of minor units. For USDC (6dp), 30000n === $0.03. */
  readonly minorUnits: bigint;
  readonly currency: CurrencyCode;
  readonly decimals: number;

  private constructor(minorUnits: bigint, currency: CurrencyCode, decimals: number) {
    if (!Number.isInteger(decimals) || decimals < 0 || decimals > 30) {
      throw new MoneyError(`Invalid decimals: ${decimals}`);
    }
    this.minorUnits = minorUnits;
    this.currency = currency;
    this.decimals = decimals;
    Object.freeze(this);
  }

  /** Construct from an exact count of minor units. */
  static fromMinorUnits(minorUnits: bigint, currency: CurrencyCode, decimals: number): Money {
    return new Money(minorUnits, currency, decimals);
  }

  /** Zero in the given currency. */
  static zero(currency: CurrencyCode, decimals: number): Money {
    return new Money(0n, currency, decimals);
  }

  /**
   * Parse a human/API decimal string such as `"0.03"`.
   *
   * Throws if the string carries more precision than the asset can represent,
   * so `"0.0000001"` is an error for 6-decimal USDC rather than a silent `0`.
   */
  static fromDecimalString(value: string, currency: CurrencyCode, decimals: number): Money {
    if (typeof value !== 'string') {
      throw new MoneyError(`Expected a decimal string, received ${typeof value}`);
    }
    const match = DECIMAL_PATTERN.exec(value.trim());
    if (!match) {
      throw new MoneyError(
        `Malformed decimal amount: ${JSON.stringify(value)}. ` +
          `Expected a plain decimal string such as "0.03".`,
      );
    }

    const sign = match[1] ?? '';
    const whole = match[2] ?? '0';
    const fraction = match[3] ?? '';

    if (fraction.length > decimals) {
      throw new MoneyError(
        `Amount ${JSON.stringify(value)} has ${fraction.length} decimal places but ` +
          `${currency} supports only ${decimals}. Refusing to truncate a monetary amount.`,
      );
    }

    const padded = fraction.padEnd(decimals, '0');
    const magnitude = BigInt(`${whole}${padded}`);
    return new Money(sign === '-' ? -magnitude : magnitude, currency, decimals);
  }

  /**
   * Canonical decimal representation, always carrying the asset's full
   * precision so the value round-trips through `fromDecimalString`.
   */
  toDecimalString(): string {
    const negative = this.minorUnits < 0n;
    const magnitude = negative ? -this.minorUnits : this.minorUnits;
    const divisor = 10n ** BigInt(this.decimals);
    const whole = magnitude / divisor;
    const sign = negative ? '-' : '';

    if (this.decimals === 0) {
      return `${sign}${whole.toString()}`;
    }
    const fraction = (magnitude % divisor).toString().padStart(this.decimals, '0');
    return `${sign}${whole.toString()}.${fraction}`;
  }

  /** The wire representation used on-chain and in payment challenges. */
  toMinorUnitString(): string {
    return this.minorUnits.toString();
  }

  private assertSameCurrency(other: Money, operation: string): void {
    if (this.currency !== other.currency || this.decimals !== other.decimals) {
      throw new MoneyError(
        `Cannot ${operation} ${this.currency}(${this.decimals}dp) and ` +
          `${other.currency}(${other.decimals}dp). Currency conversion must be explicit.`,
      );
    }
  }

  add(other: Money): Money {
    this.assertSameCurrency(other, 'add');
    return new Money(this.minorUnits + other.minorUnits, this.currency, this.decimals);
  }

  subtract(other: Money): Money {
    this.assertSameCurrency(other, 'subtract');
    return new Money(this.minorUnits - other.minorUnits, this.currency, this.decimals);
  }

  /**
   * Scale by a rational number, used for percentage fees.
   *
   * Expressed as an explicit numerator/denominator pair rather than a float
   * rate: a 0.8% platform fee is `multiplyByRatio(8n, 1000n)`, which has an
   * exact integer meaning. The rounding mode is required, not defaulted,
   * because the correct choice differs between fees we charge and amounts we
   * owe, and picking silently is how money goes missing.
   */
  multiplyByRatio(numerator: bigint, denominator: bigint, rounding: Rounding): Money {
    if (denominator === 0n) {
      throw new MoneyError('Cannot scale money by a zero denominator');
    }
    const product = this.minorUnits * numerator;
    const quotient = product / denominator;
    const remainder = product % denominator;

    if (remainder === 0n) {
      return new Money(quotient, this.currency, this.decimals);
    }

    switch (rounding) {
      case Rounding.Exact:
        throw new MoneyError(
          `Scaling ${this.toDecimalString()} ${this.currency} by ${numerator}/${denominator} ` +
            `is not exact and Rounding.Exact was requested.`,
        );
      case Rounding.Down:
        // BigInt division already truncates toward zero.
        return new Money(quotient, this.currency, this.decimals);
      case Rounding.HalfUp: {
        const twiceRemainder = (remainder < 0n ? -remainder : remainder) * 2n;
        const absDenominator = denominator < 0n ? -denominator : denominator;
        if (twiceRemainder < absDenominator) {
          return new Money(quotient, this.currency, this.decimals);
        }
        const step = product < 0n === denominator < 0n ? 1n : -1n;
        return new Money(quotient + step, this.currency, this.decimals);
      }
      default: {
        const exhaustive: never = rounding;
        throw new MoneyError(`Unhandled rounding mode: ${String(exhaustive)}`);
      }
    }
  }

  /** Returns -1, 0, or 1. Throws on currency mismatch. */
  compare(other: Money): -1 | 0 | 1 {
    this.assertSameCurrency(other, 'compare');
    if (this.minorUnits < other.minorUnits) return -1;
    if (this.minorUnits > other.minorUnits) return 1;
    return 0;
  }

  equals(other: Money): boolean {
    return (
      this.currency === other.currency &&
      this.decimals === other.decimals &&
      this.minorUnits === other.minorUnits
    );
  }

  isZero(): boolean {
    return this.minorUnits === 0n;
  }

  isNegative(): boolean {
    return this.minorUnits < 0n;
  }

  isPositive(): boolean {
    return this.minorUnits > 0n;
  }

  /** JSON form. Amounts stay strings so no consumer can parse them into a float. */
  toJSON(): { amount: string; currency: CurrencyCode; decimals: number } {
    return {
      amount: this.toMinorUnitString(),
      currency: this.currency,
      decimals: this.decimals,
    };
  }

  toString(): string {
    return `${this.toDecimalString()} ${this.currency}`;
  }
}
