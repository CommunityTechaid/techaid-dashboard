import { Component } from '@angular/core';
import { FieldType } from '@ngx-formly/core';
import { QuillEditorComponent } from 'ngx-quill';
import { ReactiveFormsModule } from '@angular/forms';

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
    imports: [QuillEditorComponent, ReactiveFormsModule]
})
export class RichTextComponent extends FieldType {}
