import type { ProducerSettings } from '../interfaces/producer-settings.interface';

export const SETTINGS_FIELDS = [
  { key: 'instrumentCount', label: 'Instrument count', min: 1, max: 50 },
  { key: 'updatesPerBatch', label: 'Updates per batch', min: 1, max: 1000 },
  { key: 'batchIntervalMs', label: 'Batch interval (ms)', min: 50, max: 2000 },
] as const;

export function validateProducerSettings(settings: ProducerSettings): void {
  for (const field of SETTINGS_FIELDS) {
    const value = settings[field.key];
    if (!Number.isInteger(value) || value < field.min || value > field.max) {
      throw new Error(
        `${field.label} must be an integer from ${field.min} to ${field.max}`,
      );
    }
  }
}
