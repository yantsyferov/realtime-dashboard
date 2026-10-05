import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import type { MarketState } from '../../interfaces/market-state.interface';
import type { ProducerSettings } from '../../interfaces/producer-settings.interface';
import { MarketService } from '../../market/market.service';
import { Settings } from './settings.component';

function initialState(overrides: Partial<MarketState> = {}): MarketState {
  return {
    rows: [],
    settings: { instrumentCount: 5, updatesPerBatch: 100, batchIntervalMs: 500 },
    status: 'running',
    error: null,
    ...overrides,
  };
}

class MarketServiceStub {
  readonly stateSubject = new BehaviorSubject<MarketState>(initialState());
  readonly state$ = this.stateSubject.asObservable();
  readonly applySettings = vi.fn<(settings: ProducerSettings) => boolean>(() => true);

  get currentSettings(): ProducerSettings {
    return { ...this.stateSubject.value.settings };
  }
}

function createComponent() {
  const market = new MarketServiceStub();
  const router = { navigate: vi.fn().mockResolvedValue(true) };

  TestBed.configureTestingModule({
    providers: [
      { provide: MarketService, useValue: market },
      { provide: Router, useValue: router },
    ],
  });

  const fixture = TestBed.createComponent(Settings);
  fixture.detectChanges();
  return { fixture, component: fixture.componentInstance, market, router };
}

describe('Settings component', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    TestBed.resetTestingModule();
  });

  it('seeds the form from the current settings snapshot', () => {
    const { component } = createComponent();
    expect(component['form'].getRawValue()).toEqual({
      instrumentCount: 5,
      updatesPerBatch: 100,
      batchIntervalMs: 500,
    });
  });

  it('does not call applySettings as fields change', () => {
    const { component, market } = createComponent();
    component['form'].controls.instrumentCount.setValue(10);
    component['form'].controls.updatesPerBatch.setValue(250);
    expect(market.applySettings).not.toHaveBeenCalled();
  });

  it('skips applySettings when any field is out of range', () => {
    const { component, market } = createComponent();
    component['form'].controls.instrumentCount.setValue(0);
    (component as unknown as { apply(): void }).apply();
    expect(market.applySettings).not.toHaveBeenCalled();
  });

  it('skips applySettings for a fractional value', () => {
    const { component, market } = createComponent();
    component['form'].controls.instrumentCount.setValue(5.5);
    (component as unknown as { apply(): void }).apply();
    expect(market.applySettings).not.toHaveBeenCalled();
  });

  it('calls applySettings with the current form value on Apply', () => {
    const { component, market } = createComponent();
    component['form'].controls.instrumentCount.setValue(10);
    component['form'].controls.updatesPerBatch.setValue(200);
    (component as unknown as { apply(): void }).apply();

    expect(market.applySettings).toHaveBeenCalledTimes(1);
    expect(market.applySettings).toHaveBeenCalledWith({
      instrumentCount: 10,
      updatesPerBatch: 200,
      batchIntervalMs: 500,
    });
  });

  it('shows a success message and navigates to the dashboard after Apply', () => {
    const { component, router } = createComponent();
    (component as unknown as { apply(): void }).apply();

    const message = (component as unknown as { successMessage(): string | null })
      .successMessage();
    expect(message).toMatch(/applied/i);

    expect(router.navigate).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1200);
    expect(router.navigate).toHaveBeenCalledWith(['/']);
  });

  it('does not navigate when applySettings rejects the update', () => {
    const { component, market, router } = createComponent();
    market.applySettings.mockReturnValueOnce(false);
    (component as unknown as { apply(): void }).apply();

    expect(router.navigate).not.toHaveBeenCalled();
    const message = (component as unknown as { successMessage(): string | null })
      .successMessage();
    expect(message).toBeNull();
    vi.advanceTimersByTime(5000);
    expect(router.navigate).not.toHaveBeenCalled();
  });
});
