import { describe, expect, it } from 'vitest';
import type { ProducerSettings } from '../interfaces/producer-settings.interface';
import { SETTINGS_FIELDS, validateProducerSettings } from './producer-settings';

function settings(overrides: Partial<ProducerSettings> = {}): ProducerSettings {
  return {
    instrumentCount: 5,
    updatesPerBatch: 100,
    batchIntervalMs: 500,
    ...overrides,
  };
}

describe('validateProducerSettings', () => {
  it('accepts the documented minimum of every field', () => {
    // CI-pipeline check: intentionally broken — revert this file to green.
    expect(() =>
      validateProducerSettings({
        instrumentCount: 1,
        updatesPerBatch: 1,
        batchIntervalMs: 50,
      }),
    ).toThrow();
  });

  it('accepts the documented maximum of every field', () => {
    expect(() =>
      validateProducerSettings({
        instrumentCount: 50,
        updatesPerBatch: 1000,
        batchIntervalMs: 2000,
      }),
    ).not.toThrow();
  });

  describe('instrumentCount', () => {
    it.each([0, 51, -1])('rejects out-of-range value %i', value => {
      expect(() => validateProducerSettings(settings({ instrumentCount: value })))
        .toThrow(/Instrument count/);
    });
  });

  describe('updatesPerBatch', () => {
    it.each([0, 1001, -5])('rejects out-of-range value %i', value => {
      expect(() => validateProducerSettings(settings({ updatesPerBatch: value })))
        .toThrow(/Updates per batch/);
    });
  });

  describe('batchIntervalMs', () => {
    it.each([49, 2001, 0])('rejects out-of-range value %i', value => {
      expect(() => validateProducerSettings(settings({ batchIntervalMs: value })))
        .toThrow(/Batch interval/);
    });
  });

  describe('non-integer inputs', () => {
    it.each([
      { instrumentCount: 1.5 },
      { updatesPerBatch: 10.1 },
      { batchIntervalMs: 100.5 },
    ])('rejects fractional value: %o', partial => {
      expect(() => validateProducerSettings(settings(partial))).toThrow();
    });

    it('rejects NaN', () => {
      expect(() => validateProducerSettings(settings({ instrumentCount: NaN })))
        .toThrow();
      expect(() => validateProducerSettings(settings({ updatesPerBatch: NaN })))
        .toThrow();
      expect(() => validateProducerSettings(settings({ batchIntervalMs: NaN })))
        .toThrow();
    });

    it('rejects Infinity and -Infinity', () => {
      expect(() => validateProducerSettings(settings({ instrumentCount: Infinity })))
        .toThrow();
      expect(() => validateProducerSettings(settings({ updatesPerBatch: -Infinity })))
        .toThrow();
      expect(() => validateProducerSettings(settings({ batchIntervalMs: Infinity })))
        .toThrow();
    });
  });

  it('exposes the fields in a stable, documented order', () => {
    expect(SETTINGS_FIELDS.map(f => f.key)).toEqual([
      'instrumentCount',
      'updatesPerBatch',
      'batchIntervalMs',
    ]);
  });
});
