import { describe, expect, it } from 'vitest';
import {
  setMinRequestInterval,
  setServiceInterval,
  throttle,
} from '../src/retrieval/rateLimiter.js';

describe('rate limiter', () => {
  it('paces requests per service', async () => {
    setServiceInterval('test-pace', 25);

    const start = Date.now();
    await throttle('test-pace');
    await throttle('test-pace');
    const elapsed = Date.now() - start;

    expect(elapsed).toBeGreaterThanOrEqual(20);
    setServiceInterval('test-pace', 0);
  });

  it('can be disabled', async () => {
    setMinRequestInterval(0);
    setServiceInterval('test-disabled', 1_000);
    setServiceInterval('test-disabled', 0);

    const start = Date.now();
    await throttle('test-disabled');
    await throttle('test-disabled');

    expect(Date.now() - start).toBeLessThan(100);
  });
});