import { ChangeDetectionStrategy, Component, DestroyRef, Input, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Observable } from 'rxjs';
import { skip } from 'rxjs/operators';
import { ToastrService } from 'ngx-toastr';
import gql from 'graphql-tag';
import { Apollo } from 'apollo-angular';
import { Select } from '@ngxs/store';
import { CoreWidgetState } from '@views/corewidgets/state/corewidgets.state';
import { KIT_STATUS } from '../kit-info/kit-info.component';
import { DatePipe } from '@angular/common';
import { LatestDraw } from '@app/shared/utils';

const QUERY_ENTITY = gql`
  query getAuditTrail($id: Long!) {
    kitAudits(where: $id) {
      changedNothingAudited
      siblingKitsInRevision
      revision {
        id
        timestamp
        customUser
      }
      type
      entity {
        model
        status
        serialNo
        updatedAt
        createdAt
        subStatus {
          installationOfOSFailed
          wipeFailed
          needsSparePart
          needsFurtherInvestigation
          network
          installedOSName
          lockedToUser
        }
      }
    }
  }
`;

@Component({
    selector: 'kit-audit-component',
    styleUrls: ['kit-audit-component.scss'],
    templateUrl: './kit-audit-component.html',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [DatePipe]
})
export class KitAuditComponent implements OnInit {
  /** Drops out-of-order responses — see LatestDraw. */
  private readonly draws = new LatestDraw();
  private readonly toastr = inject(ToastrService);
  private readonly apollo = inject(Apollo);
  private readonly destroyRef = inject(DestroyRef);

  @Input()
  set kitId(kitId: any) {
    this._kitId = kitId;
  }
  _kitId = -1;

  @Input()
  pageLength = 10;

  @Input()
  tableId = 'kit-audit-component';

  /**
   * Every revision the server returned, before collateral is filtered out. `entities` is what the
   * table renders; `hiddenCollateral` is measured against this, and it is what comes back when
   * the reader asks to see everything. Signals, so the page repaints with no zone.js (#115).
   */
  readonly allEntities = signal<readonly any[]>([]);
  readonly showCollateral = signal(false);
  /** True once the first response (or failure) has landed, so "No data!" never flashes before it. */
  readonly loaded = signal(false);

  readonly hiddenCollateral = computed(() => this.allEntities().filter(isCollateral).length);
  readonly entities = computed(() =>
    this.showCollateral() ? this.allEntities() : this.allEntities().filter(r => !isCollateral(r)));

  statusTypes: any = KIT_STATUS;

  @Select(CoreWidgetState.query) search$: Observable<string>;

  private queryRef: ReturnType<Apollo['watchQuery']>;

  ngOnInit() {
    this.queryRef = this.apollo.watchQuery({
      query: QUERY_ENTITY,
      variables: { id: this._kitId },
    });
    this.load();
    // The header search box has never filtered this table (it sent no term); it only refetched.
    // Kept as it was. The first emission is the current value, not a keystroke.
    this.search$.pipe(skip(1), takeUntilDestroyed(this.destroyRef)).subscribe(() => this.load());
  }

  private load(): void {
    const token = this.draws.start();
    this.queryRef.refetch({
      id: this._kitId,
    }).then(
      (res: any) => {
        if (this.draws.isStale(token)) {
          return;
        }
        if (res.data) {
          this.allEntities.set(res.data.kitAudits ?? []);
        }
        this.loaded.set(true);
      },
      (err: any) => {
        if (this.draws.isStale(token)) {
          return;
        }
        this.loaded.set(true);
        this.toastr.warning(`
            <small>${err.message}</small>
          `, 'GraphQL Error', { enableHtml: true, timeOut: 15000, disableTimeOut: true });
      },
    );
  }

  toggleCollateral() {
    this.showCollateral.update(v => !v);
  }
}

/**
 * Collateral = a device rewritten without anything about it changing, because it was a sibling in
 * someone else's transaction (#148, fixed 2026-08-13). 83,179 such rows exist in production and
 * they arrived in bursts of up to 2,927, so a device's real history can be buried under dozens
 * of identical entries.
 *
 * BOTH conditions are required. `changedNothingAudited` on its own also matches a genuine edit
 * to the device's attributes (notes, state, credentials, network), which is @NotAudited and so
 * has nothing to show in this table either. Those are real work by real people and hiding them
 * would be a regression; only collateral arrives with siblings.
 *
 * Nothing is deleted and nothing is hidden from the server: the notice states the count and the
 * reader can show them.
 */
function isCollateral(r: any): boolean {
  return r.changedNothingAudited && r.siblingKitsInRevision > 0;
}
