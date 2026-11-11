import { Component, ViewEncapsulation, OnInit, OnDestroy, ChangeDetectionStrategy, signal } from '@angular/core';
import { Subscription } from 'rxjs';
import { NgbModal, NgbNav, NgbNavItem, NgbNavItemRole, NgbNavLink, NgbNavLinkBase, NgbNavContent, NgbNavOutlet } from '@ng-bootstrap/ng-bootstrap';
import { ToastrService } from 'ngx-toastr';
import gql from 'graphql-tag';
import { Apollo } from 'apollo-angular';
import { UntypedFormGroup } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { UserRolesComponent } from '../user-roles/user-roles.component';
import { UserPermissionsComponent } from '../user-permissions/user-permissions.component';

const QUERY_USER = gql`
query findUser($id: String!) {
  user(id: $id){
    id: userId
     userId
     phoneNumber
     email
     name
     picture
     lastLogin
  }
}
`;


@Component({
    selector: 'user-info',
    styleUrls: ['user-info.scss'],
    templateUrl: './user-info.html',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [RouterLink, NgbNav, NgbNavItem, NgbNavItemRole, NgbNavLink, NgbNavLinkBase, NgbNavContent, UserRolesComponent, UserPermissionsComponent, NgbNavOutlet]
})
export class UserInfoComponent implements OnInit, OnDestroy {

  constructor(
    private modalService: NgbModal,
    private activatedRoute: ActivatedRoute,
    private router: Router,
    private toastr: ToastrService,
    private apollo: Apollo
  ) {

  }
  sub: Subscription;
  form: UntypedFormGroup = new UntypedFormGroup({});
  // Signals: written from Apollo/router callbacks, so they repaint without zone.js (#115).
  readonly model = signal<{ id?: string; name?: string; email?: string }>({});
  readonly userName = signal<string>(undefined);
  readonly userId = signal<string>(undefined);

  private queryRef = this.apollo
    .watchQuery({
      query: QUERY_USER,
      variables: {}
    });

  modal(content) {
    this.modalService.open(content, { centered: true });
  }

  private fetchData() {
    if (!this.userId()) {
      return;
    }

    this.queryRef.refetch({
      id: this.userId()
    }).then(res => {
      if (res.data && res.data['user']) {
        const user = res.data['user'];
        this.model.set(user);
        this.userName.set(user['name']);
      } else {
        this.model.set({});
        this.userName.set('Not Found!');
      }
    }, err => {
      this.toastr.warning(`
          <small>${err.message}</small>
        `, 'GraphQL Error', {
          enableHtml: true,
          timeOut: 15000,
          disableTimeOut: true
        });
    });
  }


  ngOnInit() {
    this.sub = this.activatedRoute.params.subscribe(params => {
      this.userId.set(params['userId']);
      this.fetchData();
    });
  }

  ngOnDestroy() {
    if (this.sub) {
      this.sub.unsubscribe();
    }
  }
}
