import { Component } from '@angular/core';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./angular-styles.css']
})
export class AppComponent {
  title = 'angular-app';
  isDisabled = false;
  dynamicClass = 'primary';
  textClass = 'header';

  onClick() {
    this.isDisabled = !this.isDisabled;
  }
}