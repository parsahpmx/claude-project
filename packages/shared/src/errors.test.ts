import { describe, expect, it } from 'vitest';
import {
  ERROR_DEFINITIONS,
  Meter402Error,
  isMeter402Error,
  notFound,
  permissionDenied,
  toPublicError,
  validationFailed,
} from './errors.js';

describe('Meter402Error', () => {
  it('takes its status and message from the code definition', () => {
    const error = new Meter402Error('PAYMENT_ALREADY_USED');
    expect(error.httpStatus).toBe(409);
    expect(error.message).toBe(ERROR_DEFINITIONS.PAYMENT_ALREADY_USED.defaultMessage);
    expect(error.retryable).toBe(false);
  });

  it('renders the documented envelope', () => {
    const error = new Meter402Error('WRONG_AMOUNT', 'Too little.', {
      details: { expected: '30000', observed: '29999' },
    });
    expect(error.toEnvelope('req_abc')).toEqual({
      error: {
        code: 'WRONG_AMOUNT',
        message: 'Too little.',
        requestId: 'req_abc',
        documentationUrl: 'https://docs.meter402.com/errors/wrong_amount',
        details: { expected: '30000', observed: '29999' },
      },
    });
  });

  it('omits details entirely when there are none', () => {
    expect(new Meter402Error('RATE_LIMITED').toEnvelope('req_abc').error).not.toHaveProperty(
      'details',
    );
  });
});

describe('httpStatus override', () => {
  it('preserves a more specific 4xx status while keeping the code stable', () => {
    const error = new Meter402Error('VALIDATION_FAILED', 'Body too large', { httpStatus: 413 });
    expect(error.httpStatus).toBe(413);
    expect(error.code).toBe('VALIDATION_FAILED');
  });

  it.each([500, 502, 503, 200, 302, 399, 600])(
    'ignores an out-of-range override of %i',
    (status) => {
      // An override must never be able to dress a server fault up as a client
      // error and hide it from error-rate alerting.
      const error = new Meter402Error('VALIDATION_FAILED', undefined, { httpStatus: status });
      expect(error.httpStatus).toBe(422);
    },
  );
});

describe('toPublicError', () => {
  it('passes a domain error through unchanged', () => {
    const original = new Meter402Error('PAYMENT_EXPIRED');
    expect(toPublicError(original)).toBe(original);
  });

  it('discards the message of an unexpected throwable', () => {
    // An arbitrary error can carry a connection string, another tenant's row,
    // or a filesystem path.
    const converted = toPublicError(new Error('postgresql://admin:hunter2@db/meter402'));
    expect(converted.code).toBe('INTERNAL_ERROR');
    expect(converted.message).not.toContain('hunter2');
    expect(converted.httpStatus).toBe(500);
  });

  it.each([null, undefined, 'a string', 42, { weird: true }, Symbol('x')])(
    'handles a non-Error throwable (%s)',
    (thrown) => {
      expect(toPublicError(thrown).code).toBe('INTERNAL_ERROR');
    },
  );

  it('retains the original as the cause for logging', () => {
    const original = new Error('boom');
    expect(toPublicError(original).cause).toBe(original);
  });
});

describe('error taxonomy', () => {
  it('assigns every code a plausible HTTP status', () => {
    for (const [code, definition] of Object.entries(ERROR_DEFINITIONS)) {
      expect(definition.status, code).toBeGreaterThanOrEqual(400);
      expect(definition.status, code).toBeLessThan(600);
    }
  });

  it('never marks a caller mistake as retryable', () => {
    // An agent that retries a WRONG_RECIPIENT payment just loses more money.
    for (const code of [
      'WRONG_RECIPIENT',
      'WRONG_AMOUNT',
      'WRONG_ASSET',
      'WRONG_NETWORK',
      'PAYMENT_ALREADY_USED',
      'PAYMENT_INVALID',
    ] as const) {
      expect(ERROR_DEFINITIONS[code].retryable, code).toBe(false);
    }
  });

  it('marks conditions outside the payer control as retryable', () => {
    for (const code of ['PAYMENT_NOT_CONFIRMED', 'RATE_LIMITED', 'UPSTREAM_UNAVAILABLE'] as const) {
      expect(ERROR_DEFINITIONS[code].retryable, code).toBe(true);
    }
  });

  it('builds a documentation URL per code', () => {
    expect(new Meter402Error('WRONG_NETWORK').documentationUrl).toBe(
      'https://docs.meter402.com/errors/wrong_network',
    );
  });
});

describe('convenience constructors', () => {
  it('builds a not-found error carrying the resource', () => {
    const error = notFound('Payment', 'pay_123');
    expect(error.code).toBe('RESOURCE_NOT_FOUND');
    expect(error.details).toEqual({ resource: 'Payment', id: 'pay_123' });
  });

  it('builds validation and permission errors', () => {
    expect(validationFailed('bad', { field: 'amount' }).httpStatus).toBe(422);
    expect(permissionDenied('delete this project').code).toBe('PERMISSION_DENIED');
  });

  it('recognises its own errors', () => {
    expect(isMeter402Error(new Meter402Error('CONFLICT'))).toBe(true);
    expect(isMeter402Error(new Error('nope'))).toBe(false);
    expect(isMeter402Error(null)).toBe(false);
  });
});
