import { Component, ChangeDetectionStrategy } from '@angular/core';
import { FieldType } from '@ngx-formly/core';
import { ReactiveFormsModule } from '@angular/forms';

/**
 * Plain HTML editing for CMS posts: a monospace textarea plus a live preview.
 *
 * The preview binds with a plain `[innerHTML]`, the same Angular-sanitised path the public
 * pages use to render the stored HTML. Never bypassSecurityTrustHtml here: the sanitiser is the
 * control that keeps a hostile post from reaching anonymous visitors (#118).
 */
@Component({
    selector: 'formly-html-editor',
    template: `
      <textarea
        class="form-control html-editor-source"
        spellcheck="false"
        [formControl]="formControl"
        [rows]="to.rows || 12"
        [class.is-invalid]="showError"></textarea>
      <small class="form-text text-muted">HTML. Scripts and unsafe markup are removed when the page is shown.</small>
      <div class="mt-3">
        <div class="small text-muted mb-1">Preview</div>
        <div class="html-editor-preview border rounded p-3" data-testid="html-editor-preview"
             [innerHTML]="formControl.value"></div>
      </div>
      `,
    styles: [`
      .html-editor-source { font-family: SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace; font-size: .85rem; }
      .html-editor-preview { min-height: 3rem; overflow-wrap: anywhere; background: #fff; }
    `],
    changeDetection: ChangeDetectionStrategy.Eager,
    imports: [ReactiveFormsModule]
})
export class HtmlEditorComponent extends FieldType {}
