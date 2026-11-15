import { ChangeDetectionStrategy, Component } from '@angular/core';

@Component({
  selector: 'app-test-home-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './test-home.page.html',
  styleUrl: './test-home.page.scss',
})
export class TestHomePage {}
