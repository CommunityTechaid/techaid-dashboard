import { Directive, ElementRef, Input, OnDestroy, OnInit } from '@angular/core';
import { Subject } from 'rxjs';
import $ from 'jquery';
import DataTable from 'datatables.net';
import 'datatables.net-bs5';

// DataTables 3 no longer imports jQuery itself. Hand it the bundled one, or $.fn.DataTable
// (and $.fn.dataTable below) never exist and every table fails to initialise.
DataTable.use($);

// A header click toggles ascending/descending on every table. DataTables' default adds a third
// "no order" state, so one click on the column a table is already sorted by cleared the sort
// instead of reversing it, and paging an unordered server-side result can repeat or skip rows
// (#291 fixed this for Distributions & Deliveries alone).
(DataTable as any).defaults.column.orderSequence = ['asc', 'desc'];

// Suppress DataTables' default blocking browser-alert on an ajax failure. Errors are already
// surfaced via toastr by the table components; the alert was the source of the confusing
// "Access Denied" popup when a request went out unauthenticated (e.g. during an API restart).
($.fn.dataTable as any).ext.errMode = 'none';

@Directive({ selector: '[datatable]' })
export class AppGridDirective implements OnDestroy, OnInit {
  /**
   * The DataTable option you pass to configure your table.
   */
  @Input()
  dtOptions: DataTables.Settings = {};

  /**
   * This trigger is used if one wants to trigger manually the DT rendering
   * Useful when rendering angular rendered DOM
   */
  @Input()
  dtTrigger: Subject<any>;

  /**
   * The DataTable instance built by the jQuery library [DataTables](datatables.net).
   *
   * It's possible to execute the [DataTables APIs](https://datatables.net/reference/api/) with
   * this variable.
   */
  dtInstance: Promise<DataTables.Api>;

  // Only used for destroying the table when destroying this directive
  private dt: DataTables.Api;

  constructor(private el: ElementRef) { }

  ngOnInit(): void {
    if (this.dtTrigger) {
      this.dtTrigger.subscribe(() => {
        this.displayTable();
      });
    } else {
      this.displayTable();
    }
  }

  ngOnDestroy(): void {
    if (this.dtTrigger) {
      this.dtTrigger.unsubscribe();
    }
    if (this.dt) {
      this.dt.destroy(true);
    }
  }

  private displayTable(): void {
    this.dtInstance = new Promise((resolve, reject) => {
      Promise.resolve(this.dtOptions).then(dtOptions => {
        // Using setTimeout as a "hack" to be "part" of NgZone
        setTimeout(() => {
          if (this.dt) {
            this.dt.rows().invalidate('dom').draw(false);
          } else {
            this.dt = $(this.el.nativeElement).DataTable({ ...dtOptions });
          }
          resolve(this.dt);
        });
      });
    });
  }
}
