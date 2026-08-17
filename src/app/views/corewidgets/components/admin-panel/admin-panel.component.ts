import { Component, ViewChild, OnInit } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Title } from '@angular/platform-browser';
import { FeatureFlagsComponent } from '../feature-flags/feature-flags.component';
import { BoroughAvailabilityComponent } from '../borough-availability/borough-availability.component';

/**
 * The admin panel is now two tabs, not three.
 *
 * Application Configuration held six `canPublicRequest*` switches and nothing else. They were the
 * ceiling for the borough matrix — org-request.ts builds the public device list from them and only
 * then narrows it by borough, so a device switched off globally could not be offered by any
 * borough however the matrix was set. Split across two tabs that relationship was invisible: an
 * admin could switch a borough on, save successfully, and see no change on the request form with
 * nothing to explain why.
 *
 * They are now the top row of the same grid, above the boroughs they govern, and the borough cells
 * beneath a globally-off column are disabled with the reason attached. The tab was removed rather
 * than left empty because it had no other content.
 */
@Component({
  selector: 'admin-panel',
  styleUrls: ['admin-panel.component.scss'],
  templateUrl: './admin-panel.component.html',
  imports: [RouterLink, FeatureFlagsComponent, BoroughAvailabilityComponent],
})
export class AdminPanelComponent implements OnInit {
  activeTab: 'availability' | 'flags' = 'availability';

  @ViewChild(BoroughAvailabilityComponent) availabilityTab?: BoroughAvailabilityComponent;

  constructor(private titleService: Title) {}

  ngOnInit(): void {
    this.titleService.setTitle('TaDa - Device Availability');
  }

  /**
   * Switch tabs, confirming first if it would throw away staged work.
   *
   * The availability tab holds edits that are not saved until its own Save is pressed, and it is
   * destroyed when the tab changes. Without this, clicking another tab silently discarded a matrix
   * the admin had spent time on — its own Discard button asks for confirmation, so the far easier
   * path was the destructive one.
   */
  selectTab(tab: 'availability' | 'flags'): void {
    if (this.activeTab === 'availability' && tab !== 'availability' && this.availabilityTab?.dirty) {
      const unsaved = this.availabilityTab.unsavedCount;
      const confirmed = window.confirm(
        `You have ${unsaved} unsaved change${unsaved === 1 ? '' : 's'}.\n\n` +
          'Leaving this tab discards them. Continue?',
      );
      if (!confirmed) return;
    }
    this.activeTab = tab;
  }
}
