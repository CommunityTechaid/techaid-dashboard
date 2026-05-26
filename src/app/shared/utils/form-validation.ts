import { UntypedFormGroup } from '@angular/forms';
import { FormlyFieldConfig } from '@ngx-formly/core';
import { ToastrService } from 'ngx-toastr';

function collectInvalidFieldLabels(fields: FormlyFieldConfig[] = [], out: string[] = []): string[] {
  for (const f of fields) {
    if (f.fieldGroup && f.fieldGroup.length) {
      collectInvalidFieldLabels(f.fieldGroup, out);
      continue;
    }
    const control = f.formControl;
    if (!control || control.valid || control.disabled) continue;
    const label = (f.templateOptions?.label as string) || (f.key as string) || '';
    if (label && !out.includes(label)) out.push(label);
  }
  return out;
}

// Returns true if the form was invalid (caller should bail), false if it was valid.
// On invalid: marks all controls touched (so Formly surfaces per-field errors), collects
// the labels of every invalid field, and shows an error toast naming them.
export function warnIfFormInvalid(
  form: UntypedFormGroup,
  fields: FormlyFieldConfig[],
  toastr: ToastrService,
  title = 'Cannot save',
): boolean {
  if (!form.invalid) return false;
  form.markAllAsTouched();
  const missing = collectInvalidFieldLabels(fields);
  const body = missing.length
    ? `<small>Required fields are incomplete: ${missing.join(', ')}</small>`
    : `<small>Required fields are incomplete. Please review the highlighted fields above.</small>`;
  toastr.error(body, title, { enableHtml: true });
  return true;
}
