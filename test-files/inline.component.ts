import { Component } from '@angular/core';

@Component({
  selector: 'app-inline',
  template: `
    <div class="container">
      <h2 class="title">Inline Template</h2>
      <button 
        class="button"
        [class.active]="isActive">
        Toggle
      </button>
    </div>
  `,
  styleUrls: ['./angular-styles.css']
})
export class InlineComponent {
  isActive = true;
}