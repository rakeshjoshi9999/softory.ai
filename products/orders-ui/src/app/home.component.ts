import { Component, signal } from '@angular/core';

@Component({
  selector: 'app-orders-ui-home',
  template: '<h1>{{ title() }}</h1>',
})
export class HomeComponent {
  readonly title = signal('orders-ui');
}
