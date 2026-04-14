import { Component } from '@angular/core';
import { FieldType } from '@ngx-formly/core';

@Component({
    selector: 'formly-richtext',
    template: `
      <div [class.is-invalid]="showError">
        <quill-editor
          [formControl]="formControl"
          [readOnly]="to.disabled"
          [placeholder]="to.placeholder || ''"
          [styles]="{ minHeight: '200px' }">
        </quill-editor>
      </div>
      `,
    standalone: false
})
export class RichTextComponent extends FieldType {}
