import { Component, ViewChild, ViewEncapsulation } from '@angular/core';
import { Subject, of, forkJoin, Observable, Subscription, concat, from } from 'rxjs';
import { debounceTime, distinctUntilChanged, tap, switchMap, catchError } from 'rxjs/operators';
import { NgbModal, NgbNav, NgbNavItem, NgbNavItemRole, NgbNavLink, NgbNavLinkBase, NgbNavContent, NgbNavOutlet } from '@ng-bootstrap/ng-bootstrap';
import { ToastrService } from 'ngx-toastr';
import gql from 'graphql-tag';
import { Apollo } from 'apollo-angular';
import { UntypedFormGroup, ReactiveFormsModule } from '@angular/forms';
import { FormlyFormOptions, FormlyFieldConfig, FormlyModule } from '@ngx-formly/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Select } from '@ngxs/store';
import { UserState } from '@app/state/state.module';
import { User } from '@app/state/user/user.state';

import { DeviceRequestComponent } from '../device-request-component/device-request-component.component';

const QUERY_ENTITY = gql`
  query findReferringOrganisationContact($id: Long) {
    referringOrganisationContact(where: { id: { _eq: $id } }) {
      id
      fullName
      email
      phoneNumber
      address
      createdAt
      updatedAt
      archived
      referringOrganisation {
        id
        name
      }
      notes {
        id
        content
        volunteer
        createdAt
        updatedAt
      }
    }
  }
`;

const UPDATE_ENTITY = gql`
  mutation updateReferringOrganisation($data: UpdateReferringOrganisationContactInput!) {
    updateReferringOrganisationContact(data: $data) {
      id
      fullName
      email
      phoneNumber
      address
      archived
      referringOrganisation {
        id
        name
      }
      notes {
        id
        content
        volunteer
        createdAt
        updatedAt
      }
    }
  }
`;

const DELETE_ENTITY = gql`
  mutation deleteReferringOrganisationContact($id: ID!) {
    deleteReferringOrganisationContact(id: $id)
  }
`;

const AUTOCOMPLETE_REFERRING_ORGANISATIONS = gql`
query findAutocompleteReferringOrganisations($term: String) {
  referringOrganisationsConnection(page: {
    size: 50
  }, where: {
    name: { _contains: $term }
    archived: { _eq: false }

  }){
    content  {
      id
      name
      archived
    }
  }
}
`;

@Component({
    selector: 'app-referring-organisation-contact-info',
    templateUrl: './referring-organisation-contact-info.component.html',
    styleUrls: ['./referring-organisation-contact-info.component.scss'],
    imports: [RouterLink, NgbNav, NgbNavItem, NgbNavItemRole, NgbNavLink, NgbNavLinkBase, NgbNavContent, ReactiveFormsModule, FormlyModule, DeviceRequestComponent, NgbNavOutlet]
})
export class ReferringOrganisationContactInfoComponent {

  constructor(
    private modalService: NgbModal,
    private activatedRoute: ActivatedRoute,
    private router: Router,
    private toastr: ToastrService,
    private apollo: Apollo
  ) {}
  sub: Subscription;
  form: UntypedFormGroup = new UntypedFormGroup({});
  options: FormlyFormOptions = {
    formState: {
      disabled: true
    }
  };
  model: any = {};
  fullName: string;
  refereeId: number;
  referringOrganisationId: number;
  public user: User;
  @Select(UserState.user) user$: Observable<User>;

  newNoteField: FormlyFieldConfig = {
    key: 'note.content',
    type: 'referee-new-note',
    templateOptions: {
      placeholder: "Type your note here and hit save"
    }
  }

  notesField: FormlyFieldConfig = {
    type: 'referee-notes',
    templateOptions: {
      notes: [],
    },
  }

  referringOrganisations$: Observable<any>;
  referringOrganisationInput$ = new Subject<string>();
  referringOrganisationLoading = false;
  referringOrganisationField: FormlyFieldConfig = {
    key: 'referringOrganisationId',
    type: 'choice',
    className: 'ms-auto text-end',
    templateOptions: {
      label: 'Referring Organisation',
      description: 'The organisation this referee is currently assigned to.',
      loading: this.referringOrganisationLoading,
      typeahead: this.referringOrganisationInput$,
      placeholder: 'Assign referee to a Referring Organisation',
      multiple: false,
      searchable: true,
      items: [],
      required: false
    },
  };

  fields: Array<FormlyFieldConfig> = [
    {
      fieldGroupClassName: 'd-flex gap-3',
      fieldGroup: [
        {
          key: 'fullName',
          type: 'input',
          className: 'col-md-6 px-0',
          defaultValue: '',
          templateOptions: {
            label: 'Full Name',
            placeholder: '',
            required: true,
          },
          validation: {
            show: false,
          },
          expressionProperties: {
            'validation.show': (model) => !!model?.showErrorState,
            'templateOptions.disabled': (model, formState) => !!formState?.disabled,
          },
        },
        this.referringOrganisationField
      ]
    },
    {
      fieldGroupClassName: 'row',
      fieldGroup: [
        {
          key: 'email',
          type: 'input',
          className: 'col-md-6',
          defaultValue: '',
          templateOptions: {
            label: 'Email',
            type: 'email',
            pattern: /^(([^<>()\[\]\\.,;:\s@"]+(\.[^<>()\[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/,
            placeholder: '',
            required: false
          },
          validation: {
            show: false,
          },
          expressionProperties: {
            'validation.show': (model) => !!model?.showErrorState,
            'templateOptions.disabled': (model, formState) => !!formState?.disabled,
          },
        },
        {
          key: 'phoneNumber',
          type: 'input',
          className: 'col-md-6',
          defaultValue: '',
          templateOptions: {
            label: 'Phone Number',
            required: false
          },
          validation: {
            show: false,
          },
          expressionProperties: {
            'validation.show': (model) => !!model?.showErrorState,
            'templateOptions.disabled': (model, formState) => !!formState?.disabled,
          },
        }
      ]
    },
    {
      fieldGroupClassName: 'row',
      fieldGroup: [
        {
          key: 'address',
          type: 'place',
          className: 'col-md-12',
          defaultValue: '',
          templateOptions: {
            label: 'Referee Address',
            placeholder: 'Your address',
            required: true
          },
          validation: {
            show: false
          },
          expressionProperties: {
            'validation.show': (model) => !!model?.showErrorState,
          }
        }
      ]
    },
    {
      fieldGroupClassName: 'row',
      fieldGroup: [
        {
          key: 'archived',
          type: 'radio',
          className: 'col-md-6',
          templateOptions: {
            type: 'array',
            label: 'Archived?',
            description: 'Archived referees are hidden from view',
            options: [
              {label: 'Referee active and visible', value: false },
              {label: 'Archive and hide this referee', value: true },
            ],
            required: true,
          }
        }
      ],
    },
    {
      fieldGroupClassName: 'row',
      fieldGroup: [
        { className: 'col-md-6', fieldGroup: [this.newNoteField] },
        { className: 'col-md-6', fieldGroup: [this.notesField] },
      ],
    },
  ];


  private queryRef = this.apollo.watchQuery({
    query: QUERY_ENTITY,
    variables: {},
  });

  modal(content) {
    this.modalService.open(content, { centered: true });
  }

  private normalizeData(data: any) {
    data = structuredClone(data); // Apollo v4 deep-freezes query/mutation responses; deep-clone before Formly writes to nested objects

    this.newNoteField.templateOptions['refereeId'] = this.refereeId;
    this.displayNotes(data);

    if (data.referringOrganisation && data.referringOrganisation.id) {
      data.referringOrganisationId = data.referringOrganisation.id;
      this.referringOrganisationField.templateOptions['items'] = [
        {label: this.referringOrganisationName(data.referringOrganisation), value: data.referringOrganisation.id}
      ];
    }
    return data;
  }

  private displayNotes(data) {
    if (data.notes) {
      var notes = [];
      data.notes.forEach(n => {
        notes.push({ content: n.content, id: n.id, volunteer: n.volunteer, updated_at: n.updatedAt });
      });
      this.notesField.templateOptions['notes'] = notes;
    }
  }

  private fetchData() {
    if (!this.refereeId) {
      return;
    }

    this.queryRef
      .refetch({
        id: this.refereeId,
      })
      .then(
        (res) => {
          if (res.data && res.data['referringOrganisationContact']) {
            const data = res.data['referringOrganisationContact'];
            this.model = this.normalizeData(data);
            this.fullName = this.model['fullName'];
            this.referringOrganisationId = this.model['referringOrganisation']['id'];
          } else {
            this.model = {};
            this.fullName = 'Not Found!';
          }
        },
        (err) => {
          this.toastr.warning(
            `
          <small>${err.message}</small>
        `,
            'GraphQL Error',
            {
              enableHtml: true,
              timeOut: 15000,
              disableTimeOut: true,
            }
          );
        }
      );
  }

  ngOnInit() {
    const referringOrganisationRef = this.apollo
      .watchQuery({
        query: AUTOCOMPLETE_REFERRING_ORGANISATIONS,
        variables: {
        }
      });

    this.referringOrganisations$ = concat(
      of([]),
      this.referringOrganisationInput$.pipe(
        debounceTime(200),
        distinctUntilChanged(),
        tap(() => this.referringOrganisationLoading = true),
        switchMap(term => from(referringOrganisationRef.refetch({
          term: term
        })).pipe(
          catchError(() => {
            this.toastr.error('Failed to load referring organisations for filter');
            return of([]);
          }),
          tap(() => this.referringOrganisationLoading = false),
          switchMap(res => {
            const data = res['data']['referringOrganisationsConnection']['content'].map(v => {
              return {
                label: `${this.referringOrganisationName(v)}`, value: v.id
              };
            });
            return of(data);
          })
        ))
      )
    );

    this.sub = this.activatedRoute.params.subscribe((params) => {
      this.refereeId = +params['refereeId'];
      this.fetchData();
    });

    this.sub.add(
      this.user$.subscribe((user) => {
        this.user = user;
        this.options.formState.disabled = !(user && user.authorities && user.authorities['write:organisations']);
      })
    );

    this.sub.add(this.referringOrganisations$.subscribe(data => {
      this.referringOrganisationField.templateOptions['items'] = data;
    }));
  }

  referringOrganisationName(data) {
    return `${data.name || ''}||${data.id || ''}`
      .split('||')
      .filter(f => f.trim().length)
      .join(' / ')
      .trim();
  }

  ngOnDestroy() {
    if (this.sub) {
      this.sub.unsubscribe();
    }
  }

  updateEntity(data: any) {
    if (!this.form.valid) {
      this.model['showErrorState'] = true;
      return;
    }
    data.id = this.refereeId;

    if (data.note && data.note.content == null) {
      data.note.content = "";
    }

    this.apollo
      .mutate({
        mutation: UPDATE_ENTITY,
        variables: {
          data,
        },
      })
      .subscribe(
        (res) => {
          this.model = this.normalizeData(res.data['updateReferringOrganisationContact']);
          this.fullName = this.model['fullName'];
          this.toastr.info(
            `
      <small>Successfully updated referee ${this.fullName}</small>
      `,
            'Updated Referee',
            {
              enableHtml: true,
            }
          );
        },
        (err) => {
          this.toastr.error(
            `
      <small>${err.message}</small>
      `,
            'Update Error',
            {
              enableHtml: true,
            }
          );
        }
      );
  }

  deleteEntity() {
    this.apollo
      .mutate<any>({
        mutation: DELETE_ENTITY,
        variables: { id: this.refereeId },
      })
      .subscribe(
        (res) => {
          if (res.data.deleteReferringOrganisationContact) {
            this.toastr.info(
              `
        <small>Successfully deleted referee ${this.fullName}</small>
        `,
              'Referee Deleted',
              {
                enableHtml: true,
              }
            );
            this.router.navigate(['/dashboard/referring-organisation-contacts']);
          }
        },
        (err) => {
          this.toastr.error(
            `
      <small>${err.message}</small>
      `,
            'Error Deleting Referee',
            {
              enableHtml: true,
            }
          );
        }
      );
  }
}
