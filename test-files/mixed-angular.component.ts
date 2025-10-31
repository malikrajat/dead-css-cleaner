import { Component } from '@angular/core';

@Component({
  selector: 'app-mixed',
  template: `
    <div id="angular-main">
      <h1 class="angular-header shared-class">Angular Header</h1>
      <div [class.angular-active]="isActive">
        Dynamic content
      </div>
    </div>
  `,
  styleUrls: ['./comprehensive-test.css']
})
export class MixedAngularComponent {
  isActive = true;
}