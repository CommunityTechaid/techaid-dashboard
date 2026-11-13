import { ChangeDetectionStrategy, Component, DestroyRef, Input, OnInit, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Observable } from 'rxjs';
import { skip } from 'rxjs/operators';
import { ToastrService } from 'ngx-toastr';
import gql from 'graphql-tag';
import { Apollo } from 'apollo-angular';
import { Select } from '@ngxs/store';
import { CoreWidgetState } from '@views/corewidgets/state/corewidgets.state';
import { DEVICE_REQUEST_STATUS } from '../device-request-info/device-request-info.component';
import { DatePipe } from '@angular/common';
import { LatestDraw } from '@app/shared/utils';
import { toastWarning } from '@app/shared/utils/error-toast';

const QUERY_ENTITY = gql`
  query getDeviceRequestAuditTrail($id: Long!) {
    deviceRequestAudits(where: $id) {
      revision {
        id
        timestamp
        customUser
      }
      type
      entity {
        status
        clientRef
        details
        borough
        updatedAt
        createdAt
        isSales
        deviceRequestItems {
          phones
          tablets
          laptops
          allInOnes
          desktops
          commsDevices
          other
          broadbandHubs
        }
      }
    }
  }
`;

@Component({
    selector: 'device-request-audit-component',
    styleUrls: ['device-request-audit-component.scss'],
    templateUrl: './device-request-audit-component.html',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [DatePipe]
})
export class DeviceRequestAuditComponent implements OnInit {
  /** Drops out-of-order responses — see LatestDraw. */
  private readonly draws = new LatestDraw();
  private readonly toastr = inject(ToastrService);
  private readonly apollo = inject(Apollo);
  private readonly destroyRef = inject(DestroyRef);

  @Input()
  set deviceRequestId(deviceRequestId: any) {
    this._deviceRequestId = deviceRequestId;
  }
  _deviceRequestId = -1;

  @Input()
  pageLength = 10;

  @Input()
  tableId = 'device-request-audit-component';

  /** Signals, so the page repaints with no zone.js (#115). */
  readonly entities = signal<readonly any[]>([]);
  /** True once the first response (or failure) has landed, so "No data!" never flashes before it. */
  readonly loaded = signal(false);

  statusTypes: any = DEVICE_REQUEST_STATUS;

  @Select(CoreWidgetState.query) search$: Observable<string>;

  private queryRef: ReturnType<Apollo['watchQuery']>;

  ngOnInit() {
    this.queryRef = this.apollo.watchQuery({
      query: QUERY_ENTITY,
      variables: { id: this._deviceRequestId },
    });
    this.load();
    // The header search box has never filtered this table (it sent no term); it only refetched.
    // Kept as it was. The first emission is the current value, not a keystroke.
    this.search$.pipe(skip(1), takeUntilDestroyed(this.destroyRef)).subscribe(() => this.load());
  }

  private load(): void {
    const token = this.draws.start();
    this.queryRef.refetch({
      id: this._deviceRequestId,
    }).then(
      (res: any) => {
        if (this.draws.isStale(token)) {
          return;
        }
        if (res.data) {
          this.entities.set(res.data.deviceRequestAudits ?? []);
        }
        this.loaded.set(true);
      },
      (err: any) => {
        if (this.draws.isStale(token)) {
          return;
        }
        this.loaded.set(true);
        toastWarning(this.toastr, err, 'GraphQL Error', { timeOut: 15000, disableTimeOut: true });
      },
    );
  }
}
