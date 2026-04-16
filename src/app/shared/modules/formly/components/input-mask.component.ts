import { Component } from '@angular/core';
import { FieldType, FormlyModule } from '@ngx-formly/core';
import { InputMaskComponent } from '../../../components/input-mask/input-mask.component';
import { ReactiveFormsModule } from '@angular/forms';

@Component({
    selector: 'formly-masked-input',
    template: `
      <div [class.is-invalid]="showError">
        <input-mask  [placeholder]="to.placeholder"  [mask]="to.mask.value" [options]="to.mask.options" [formControl]="formControl" [formlyAttributes]="field"></input-mask>
      </div>
      `,
    host: {
        '[class.d-inline-flex]': 'to.addonLeft || to.addonRight',
        '[class.custom-file]': 'to.addonLeft || to.addonRight',
    },
    imports: [InputMaskComponent, ReactiveFormsModule, FormlyModule]
})
export class MaskedInput extends FieldType {

}
