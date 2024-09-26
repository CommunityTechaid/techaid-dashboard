import { Component, Input, OnInit } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';


// Usage Instructions:
// Inside  your local component, place this HTML
// <app-local-css [style]="'body{background:green !important;}'"></app-local-css>
// OR
// <app-local-css [scriptURL]="'/path/to/file.css'"></app-local-css>

@Component({
  selector: "app-local-css",
  template: '<span style="display:none" [innerHTML]="this.safeString"></span>'
})
export class AppLocalCSS implements OnInit {
  constructor(protected sanitizer: DomSanitizer) {}
  @Input() scriptURL?: string;
  @Input() style?: string;

  safeString: SafeHtml;
  ngOnInit() {
    if (this.scriptURL) {
      let string = '<link rel="stylesheet" type="text/css" href="' + this.scriptURL + '">';
      this.safeString = this.sanitizer.bypassSecurityTrustHtml(string);
    } else if (this.style) {
      let string = '<style type="text/css">' + this.style + "</style>";
      this.safeString = this.sanitizer.bypassSecurityTrustHtml(string);
    }
  }
}
