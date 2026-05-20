import { Provider } from '@angular/core';
import { UntypedFormControl } from '@angular/forms';
import { provideFormlyConfig } from '@ngx-formly/core';
import { ConfigOption } from '@ngx-formly/core';
import { QuillModule } from 'ngx-quill';
import { AppFormlyWrapperFormField } from './wrapper/form-field.wrapper';
import { ChoiceInput } from './components/choice.component';
import { PlaceInput } from './components/place.component';
import { DateInput } from './components/date.component';
import { DateTimeInput, DateTimeInputWidget } from './components/datetime.component';
import { MaskedInput } from './components/input-mask.component';
import { GalleryInput } from './components/gallery.component';
import { RichTextComponent } from './components/richtext.component';
import { RepeatTypeComponent } from './components/repeat.component';
import { FormlyFieldButton } from './components/button.component';

export { AppFormlyWrapperFormField } from './wrapper/form-field.wrapper';
export { ChoiceInput } from './components/choice.component';
export { DateInput } from './components/date.component';
export { DateTimeInput, DateTimeInputWidget } from './components/datetime.component';
export { MaskedInput } from './components/input-mask.component';
export { RichTextComponent } from './components/richtext.component';
export { RepeatTypeComponent } from './components/repeat.component';
export { FormlyFieldButton } from './components/button.component';

export function percentageValidator(c: UntypedFormControl, field) {
    if (c.value && c.value.toString().trim()) {
        return /^-?[0-9]+\.?[0-9]+%?$/.test(c.value.toString());
    }
    return true;
}

export function numberValidator(c: UntypedFormControl, field) {
    if (c.value && c.value.toString().trim()) {
        return /^-?[0-9]+(\.[0-9]+)?$/.test(c.value.toString());
    }
    return true;
}

export const FORMLYCONFIG: ConfigOption = {
    types: [
        {
            name: 'mask',
            component: MaskedInput,
            wrappers: ['form-field'],
            defaultOptions: {
                templateOptions: {
                    mask: {
                        value: [],
                        options: { keepMask: false }
                    }
                }
            }
        },
        {
            name: 'percentage',
            component: MaskedInput,
            wrappers: ['form-field'],
            defaultOptions: {
                templateOptions: {
                    mask: {
                        options: { keepMask: true, showMask: false },
                        value: {
                            type: 'number',
                            options: {
                                allowDecimal: true,
                                includeThousandsSeparator: false,
                                integerLimit: 1,
                                requireDecimal: true,
                                suffix: '%'
                            }
                        }
                    }
                },
                validators: { pattern: percentageValidator }
            }
        },
        {
            name: 'number',
            component: MaskedInput,
            wrappers: ['form-field'],
            defaultOptions: {
                templateOptions: {
                    mask: {
                        options: { keepMask: false, showMask: true },
                        value: {
                            type: 'number',
                            options: { allowDecimal: true, includeThousandsSeparator: true }
                        }
                    }
                },
                validators: { pattern: numberValidator }
            }
        },
        {
            name: 'choice',
            component: ChoiceInput,
            wrappers: ['form-field'],
            defaultOptions: {
                templateOptions: {
                    options: [],
                    multiple: false,
                    allowClear: true,
                    closeOnSelect: true,
                    bindLabel: 'label',
                    bindValue: 'value',
                    searchable: false,
                    inline: false,
                    placeholder: ''
                }
            }
        },
        { name: 'repeat', component: RepeatTypeComponent },
        {
            name: 'richtext',
            component: RichTextComponent,
            wrappers: ['form-field'],
            defaultOptions: { templateOptions: { placeholder: '' } }
        },
        {
            name: 'place',
            component: PlaceInput,
            wrappers: ['form-field'],
            defaultOptions: {
                templateOptions: {
                    placeholder: '',
                    mapOptions: { componentRestrictions: { country: 'GB' } }
                }
            }
        },
        {
            name: 'gallery',
            component: GalleryInput,
            wrappers: ['form-field'],
            defaultOptions: { templateOptions: { placeholder: '', prefix: '' } }
        },
        {
            name: 'date',
            component: DateInput,
            wrappers: ['form-field'],
            defaultOptions: {
                templateOptions: {
                    placeholder: 'yyyy-mm-dd',
                    buttonClass: 'input-group-text',
                    displayMonths: 1,
                    navigation: 'select',
                    inline: true,
                    showWeekNumbers: false,
                    input_formats: [
                        'yyyy-MM-dd', 'yyyy/MM/dd', 'yyyy.MM.dd', 'yyyy MM dd',
                        'dd-MM-yyyy', 'dd/MM/yyyy', 'dd.MM.yyyy', 'dd MM yyyy',
                        'dd MMM yyyy', 'dd MMMM yyyy', 'MMM yyyy', 'MMMM yyyy',
                        'yyyyMMdd', 'ddMMyyyy'
                    ],
                    output_format: 'default'
                }
            }
        },
        {
            name: 'datetime',
            component: DateTimeInput,
            wrappers: ['form-field'],
            defaultOptions: {
                templateOptions: {
                    placeholder: 'yyyy-mm-dd',
                    buttonClass: 'input-group-text',
                    displayMonths: 1,
                    navigation: 'select',
                    inline: true,
                    time: {
                        seconds: false,
                        meridian: false,
                        spinners: true,
                        hourStep: 1,
                        minuteStep: 1,
                        secondStep: 1,
                    },
                    showWeekNumbers: false,
                    input_formats: [
                        'yyyy-MM-dd', 'yyyy/MM/dd', 'yyyy.MM.dd', 'yyyy MM dd',
                        'dd-MM-yyyy', 'dd/MM/yyyy', 'dd.MM.yyyy', 'dd MM yyyy',
                        'dd MMM yyyy', 'dd MMMM yyyy', 'MMM yyyy', 'MMMM yyyy',
                        'yyyyMMdd', 'ddMMyyyy'
                    ],
                    output_format: 'default'
                }
            }
        },
        {
            name: 'button',
            component: FormlyFieldButton,
            wrappers: ['form-field'],
            defaultOptions: {
                templateOptions: { btnType: 'default', type: 'button' }
            }
        }
    ],
    wrappers: [
        { name: 'form-field', component: AppFormlyWrapperFormField }
    ],
    validationMessages: [
        { name: 'required', message: 'This field is required' },
        { name: 'pattern', message: 'This field doesn\'t match the required pattern' }
    ]
};

export const formlyProviders: Provider[] = [
    provideFormlyConfig(FORMLYCONFIG),
];
