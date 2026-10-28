import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { MembershipState, MembershipTier, tierLabel } from './membership';

/**
 * The membership badge vocabulary shared by every table and detail page: a tier badge, a
 * state badge (Last request / Limit reached), an optional "used / cap" line, the Membership
 * contact badge and the Grace badge. Pure inputs, no queries — callers decide what to show.
 */
@Component({
  selector: 'membership-badges',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span class="membership-badges" data-testid="membership-badges">
      @if (contact) {
        <span class="badge badge-contact" [class.badge-lg]="large" data-testid="badge-contact">Membership contact</span>
      }
      @if (graceIndex) {
        <span class="badge badge-grace" [class.badge-lg]="large" data-testid="badge-grace">Grace {{ graceIndex }}@if (graceTotal) { of {{ graceTotal }}}</span>
      }
      @if (tier) {
        <span class="badge" [class.badge-tier-free]="tier === 'FREE'" [class.badge-tier-paid]="tier !== 'FREE'"
          [class.badge-lg]="large" data-testid="badge-tier">{{ label }}</span>
      }
      @if (expired) {
        <span class="badge badge-limit" [class.badge-lg]="large" data-testid="badge-expired">Expired</span>
      }
      @if (state === 'LAST_REQUEST') {
        <span class="badge badge-last" [class.badge-lg]="large" data-testid="badge-last">Last request</span>
      }
      @if (state === 'LIMIT_REACHED') {
        <span class="badge badge-limit" [class.badge-lg]="large" data-testid="badge-limit">Limit reached</span>
      }
      @if (showUsage && used != null) {
        <small class="text-muted membership-usage" data-testid="membership-usage">{{ used }} / {{ cap ?? '∞' }}</small>
      }
    </span>
  `,
})
export class MembershipBadgesComponent {
  @Input() tier: MembershipTier | null = null;
  @Input() state: MembershipState | null = null;
  @Input() used: number | null = null;
  @Input() cap: number | null = null;
  @Input() showUsage = false;
  @Input() contact = false;
  @Input() graceIndex: number | null = null;
  @Input() graceTotal: number | null = null;
  @Input() large = false;
  @Input() expired = false;

  /** Convenience: spread a `Membership` / `MembershipPublic` onto the inputs. */
  @Input() set membership(m: { tier?: MembershipTier; state?: MembershipState; used?: number; cap?: number | null; expired?: boolean } | null) {
    if (!m) {
      return;
    }
    this.tier = m.tier ?? null;
    this.state = m.state ?? null;
    this.used = m.used ?? null;
    this.cap = m.cap ?? null;
    this.expired = !!m.expired;
  }

  get label(): string {
    return tierLabel(this.tier);
  }
}
