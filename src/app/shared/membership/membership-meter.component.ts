import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { Membership } from './membership';

/** Usage meter for an organisation's yearly allowance. Amber at the last request, red at the limit. */
@Component({
  selector: 'membership-meter',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (membership) {
      <div class="cta-meter" data-testid="membership-meter">
        <span class="form-label mb-0">Requests this membership year</span>
        <div class="cta-meter-row">
          <strong data-testid="membership-meter-used">{{ membership.used }}@if (membership.cap != null) { of {{ membership.cap }}} used</strong>
          @if (membership.remaining != null) {
            <small class="text-muted">{{ membership.remaining > 0 ? membership.remaining : 0 }} left</small>
          } @else {
            <small class="text-muted">No cap</small>
          }
        </div>
        @if (membership.cap != null) {
          <div class="cta-meter-track" role="img" [attr.aria-label]="membership.used + ' of ' + membership.cap + ' requests used'">
            <div class="cta-meter-fill" [class.warn]="membership.state === 'LAST_REQUEST'"
              [class.full]="membership.state === 'LIMIT_REACHED'" [style.width.%]="percent"></div>
          </div>
        }
        <small class="text-muted">Counts every request in this period except declined and cancelled ones.</small>
      </div>
    }
  `,
})
export class MembershipMeterComponent {
  @Input() membership: Membership | null = null;

  get percent(): number {
    const m = this.membership;
    if (!m || !m.cap) {
      return 0;
    }
    return Math.min(100, Math.round((m.used / m.cap) * 100));
  }
}
