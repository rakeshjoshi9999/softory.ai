import { Component, signal } from '@angular/core';

@Component({
  selector: 'app-orders-admin-ui-home',
  template: '<h1>{{ title() }}</h1>',
})
export class HomeComponent {
  readonly title = signal('orders-admin-ui');
}
