import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';

@Component({
  selector: 'app-orders-ui',
  imports: [RouterOutlet],
  template: '<router-outlet />',
})
export class AppComponent {}
