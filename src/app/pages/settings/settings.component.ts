import { AsyncPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import {
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import type { ValidatorFn } from '@angular/forms';
import { MarketService } from '../../market/market.service';
import { SETTINGS_FIELDS } from '../../market/producer-settings';

const integerValidator: ValidatorFn = control => {
  return Number.isInteger(control.value) ? null : { integer: true };
};

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [AsyncPipe, ReactiveFormsModule],
  templateUrl: './settings.component.html',
  styleUrl: './settings.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Settings {
  protected readonly market = inject(MarketService);
  protected readonly fields = SETTINGS_FIELDS;
  private readonly initialSettings = this.market.currentSettings;

  protected readonly form = new FormGroup({
    instrumentCount: this.createControl('instrumentCount'),
    updatesPerBatch: this.createControl('updatesPerBatch'),
    batchIntervalMs: this.createControl('batchIntervalMs'),
  });

  protected apply(): void {
    this.form.markAllAsTouched();
    if (this.form.invalid) return;
    if (this.market.applySettings(this.form.getRawValue())) {
      this.form.markAsPristine();
    }
  }

  private createControl(
    key: (typeof SETTINGS_FIELDS)[number]['key'],
  ): FormControl<number> {
    const field = SETTINGS_FIELDS.find(item => item.key === key)!;
    return new FormControl(this.initialSettings[key], {
      nonNullable: true,
      validators: [
        Validators.required,
        Validators.min(field.min),
        Validators.max(field.max),
        integerValidator,
      ],
    });
  }
}
