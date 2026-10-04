import { AsyncPipe, CurrencyPipe, DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MarketService } from '../../market/market.service';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [AsyncPipe, CurrencyPipe, DecimalPipe],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Dashboard {
  protected readonly market = inject(MarketService);
  protected readonly symbols = ['ALFA', 'BETA', 'GAMMA', 'DELTA', 'EPSILON'];

  protected instrumentSymbol(id: number): string {
    return this.symbols[id] ?? `ASSET${id + 1}`;
  }
}
