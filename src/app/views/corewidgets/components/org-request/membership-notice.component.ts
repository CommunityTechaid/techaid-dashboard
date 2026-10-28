import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import {
  MEMBERSHIP_TIERS, MembershipNotice, MembershipPublic, formatMembershipDate, membershipRenewalDate, tierLabel,
} from '@app/shared/membership/membership';

/**
 * The membership alert above "Your client's needs" on the request form: last request, a grace
 * request (over-limit mode GRACE) or the hard block (mode BLOCK, or grace used up). `staff`
 * switches to the wording for the admin "Request Devices" form.
 *
 * Seam for a future staff override of the block (unconfirmed, out of scope for v1): the block
 * is decided by the parent from `notice`, so an override only has to change what it passes in.
 */
@Component({
  selector: 'membership-notice',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (notice && allowance) {
      @switch (notice) {
        @case ('last') {
          <div class="cta-alert cta-alert-warning mb-3" role="status" data-testid="membership-notice-last">
            <i class="fas fa-exclamation-triangle" aria-hidden="true"></i>
            <div>
              @if (staff) {
                <h3>This will be {{ org }}'s last {{ free }}request this membership year</h3>
                <p>After this request the organisation will be at {{ allowance.cap }} of {{ allowance.cap }}.
                  Further requests will be {{ staffOverLimit }} until they upgrade or renew on {{ renewal }}.</p>
                @if (contactName) {
                  <p>Consider letting the membership contact, {{ contactName }}, know about the paid tiers.</p>
                }
              } @else {
                <h3>This is your organisation's last request for this membership year</h3>
                <p>{{ org }} has used {{ allowance.used }} of its {{ allowance.cap }} {{ free }}requests for {{ period }}. You can submit this one as normal.</p>
                <p>After this, further requests will need a paid membership until your allowance renews on {{ renewal }}.
                  See the membership tiers below or email <a href="mailto:distributions@communitytechaid.org.uk">distributions&#64;communitytechaid.org.uk</a>.</p>
              }
            </div>
          </div>
        }
        @case ('grace') {
          <div class="cta-alert cta-alert-warning mb-3" role="status" data-testid="membership-notice-grace">
            <i class="fas fa-exclamation-triangle" aria-hidden="true"></i>
            <div>
              @if (staff) {
                <h3>{{ org }} has used all {{ allowance.cap }} requests for this membership year</h3>
                <p>This will be <strong>grace request {{ graceIndex }}@if (graceTotal) { of {{ graceTotal }}}</strong>.
                  Once the grace requests are used, new requests will be paused until they upgrade or renew on {{ renewal }}.</p>
              } @else {
                <h3>Your organisation has used all {{ allowance.cap }} {{ free }}requests for this membership year</h3>
                <p>You can still submit this request. It will be <strong>grace request {{ graceIndex }}@if (graceTotal) { of {{ graceTotal }}}</strong>,
                  giving you time to arrange a membership. Once the grace requests are used, new requests will be paused until you upgrade or your allowance renews on {{ renewal }}.</p>
                <p>To keep requesting devices, choose a membership tier and email <a href="mailto:distributions@communitytechaid.org.uk">distributions&#64;communitytechaid.org.uk</a>:</p>
                <ul class="mb-0">
                  @for (t of paidTiers; track t.value) {
                    <li>{{ t.label }}: {{ t.range }} ({{ t.fee }})</li>
                  }
                </ul>
              }
            </div>
          </div>
        }
        @case ('block') {
          <div class="cta-alert cta-alert-danger mb-3" role="alert" data-testid="membership-notice-block">
            <i class="fas fa-ban" aria-hidden="true"></i>
            <div>
              @if (staff) {
                <h3>{{ org }} has reached its request limit for this membership year</h3>
                <p>It has used all {{ allowance.cap }} requests for {{ period }}, so new requests can't be accepted until it upgrades or renews on {{ renewal }}.</p>
              } @else {
                <h3>Your organisation has reached its request limit for this membership year</h3>
                <p>{{ org }} has used all {{ allowance.cap }} {{ free }}requests for {{ period }}, so we can't accept new requests right now.</p>
                <p>To request more devices, upgrade to a paid membership by emailing <a href="mailto:distributions@communitytechaid.org.uk">distributions&#64;communitytechaid.org.uk</a>.
                  Otherwise your allowance renews on <strong>{{ renewal }}</strong>.</p>
              }
            </div>
          </div>
        }
      }
    }
  `,
})
export class MembershipNoticeComponent {
  @Input() notice: MembershipNotice = null;
  @Input() allowance: MembershipPublic | null = null;
  @Input() organisationName: string | null = null;
  @Input() graceTotal: number | null = null;
  @Input() overLimitMode: string | null = null;
  @Input() contactName: string | null = null;
  @Input() staff = false;

  readonly paidTiers = MEMBERSHIP_TIERS.filter(t => t.value !== 'FREE');

  get org(): string {
    return this.organisationName || (this.staff ? 'This organisation' : 'Your organisation');
  }

  /** "free " for the free tier, so paid tiers don't read as free requests. */
  get free(): string {
    return this.allowance?.tier === 'FREE' ? 'free ' : '';
  }

  get graceIndex(): number {
    return (this.allowance?.graceUsed ?? 0) + 1;
  }

  get period(): string {
    const end = this.allowance?.periodEnd;
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(end || '');
    if (!m) {
      return 'this membership year';
    }
    const start = new Date(Date.UTC(+m[1] - 1, +m[2] - 1, +m[3] + 1)).toISOString().slice(0, 10);
    return `${formatMembershipDate(start)} to ${formatMembershipDate(end)}`;
  }

  get renewal(): string {
    return formatMembershipDate(membershipRenewalDate(this.allowance?.periodEnd)) || 'renewal';
  }

  get staffOverLimit(): string {
    if (this.overLimitMode === 'GRACE') {
      return `accepted as grace requests${this.graceTotal ? ` (up to ${this.graceTotal})` : ''}, then paused,`;
    }
    if (this.overLimitMode === 'BLOCK') {
      return 'refused';
    }
    return 'handled under the over-limit rule';
  }

  get tier(): string {
    return tierLabel(this.allowance?.tier);
  }
}
