import { Component, inject } from '@angular/core';
import { RouterLink, RouterOutlet } from '@angular/router';
import { MarketService } from './market/market.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, RouterLink],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  protected readonly market = inject(MarketService);
}
