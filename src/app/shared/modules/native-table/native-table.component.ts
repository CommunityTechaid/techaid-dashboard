import {
  ChangeDetectionStrategy, Component, DestroyRef, Directive, OnInit, TemplateRef,
  computed, contentChild, inject, input, output, signal,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { LatestDraw } from '@app/shared/utils/latest-draw';
import {
  PagingType, SortDirection, TableColumn, TableOrder, TableQuery, TableSource, pageNumbers,
} from './table-types';

/** How long a table remembers its page, length, order and search (DataTables' `stateDuration` default). */
const STATE_TTL_MS = 2 * 60 * 60 * 1000;

/** Delay between the last keystroke and the search request (DataTables' `searchDelay` default for server-side). */
const SEARCH_DELAY_MS = 400;

interface SavedState {
  time: number;
  page: number;
  size: number;
  term: string;
  order: TableOrder;
}

/**
 * Marks the `<ng-template>` that renders one row. The template must produce the `<tr>`, so the
 * host keeps control of row classes, click handlers and cell content:
 *
 *   <ng-template ctaRow let-row><tr>...</tr></ng-template>
 */
@Directive({ selector: 'ng-template[ctaRow]' })
export class NativeTableRowDirective<T = unknown> {
  readonly template = inject<TemplateRef<{ $implicit: T; index: number }>>(TemplateRef);

  static ngTemplateContextGuard<T>(_dir: NativeTableRowDirective<T>, _ctx: unknown): _ctx is { $implicit: T; index: number } {
    return true;
  }
}

/**
 * Server-side paged, sortable, searchable table. Replaces the jQuery DataTables + AppGridDirective
 * pair: the host supplies a `source` function that turns a query (page, size, sort, term) into
 * rows and a total, and a row template. The shell owns paging, the sort cycle, the debounced
 * search, the info line, the page-length menu and per-table state saving; everything the user
 * sees keeps DataTables' markup and class names (`dt-container`, `dt-search`, `dt-info`,
 * `dt-paging`, `<id>_wrapper`) so existing styles and e2e selectors keep working.
 *
 * Plan and migration order: docs/native-tables-plan.md.
 *
 * Rows are handed to the template exactly as the source returned them. Apollo v4 freezes its
 * responses, so the shell never writes to a row; a host that derives fields does it in `source`
 * with map + spread.
 */
@Component({
  selector: 'cta-table',
  templateUrl: './native-table.component.html',
  imports: [NgTemplateOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NativeTableComponent<T = unknown> implements OnInit {
  readonly tableId = input.required<string>();
  readonly columns = input.required<readonly TableColumn[]>();
  readonly source = input.required<TableSource<T>>();
  /** Order on first load, before the user clicks a header. */
  readonly order = input<TableOrder>({ column: 0, dir: 'desc' });
  readonly pageLength = input(10);
  /** Page-length menu entries. An empty list hides the menu. */
  readonly pageLengths = input<readonly number[]>([5, 10, 25, 50, 100]);
  readonly pagingType = input<PagingType>('simple_numbers');
  readonly searchable = input(true);
  readonly tableClass = input('table table-striped table-hover table-bordered table-md');
  /** Keep page, length, order and search across navigation (DataTables `stateSave`). */
  readonly persistState = input(true);

  /** A request failed. The shell empties the table; the host decides how to tell the user. */
  readonly loadError = output<unknown>();

  private readonly destroyRef = inject(DestroyRef);
  private readonly draws = new LatestDraw();
  private searchTimer: ReturnType<typeof setTimeout> | undefined;
  /**
   * False until `ngOnInit` has restored state and made the first request. The header search box
   * subscription in a host (NGXS replays the current value on subscribe) can fire after the shell
   * exists but before its inputs are bound; `search()` and `reload()` are ignored until then, as
   * they were while DataTables had not yet produced its instance.
   */
  private ready = false;

  readonly page = signal(0);
  readonly pageSize = signal(10);
  readonly sortOrder = signal<TableOrder>({ column: 0, dir: 'desc' });
  /** The search term in force (and shown in the box). */
  readonly term = signal('');
  readonly rows = signal<readonly T[]>([]);
  /** Rows matching the term. */
  readonly total = signal(0);
  /** Rows with no term, when known. Drives "(filtered from N total entries)". */
  readonly unfilteredTotal = signal<number | null>(null);
  readonly loading = signal(false);
  /** True once the first response (or failure) has landed, so "No data!" never flashes before it. */
  readonly loaded = signal(false);

  protected readonly rowTemplate = contentChild(NativeTableRowDirective);

  protected readonly pageCount = computed(() => Math.max(1, Math.ceil(this.total() / this.pageSize())));
  protected readonly atLastPage = computed(() => this.page() >= this.pageCount() - 1);
  protected readonly pageItems = computed(() => pageNumbers(this.page(), this.pageCount()));

  protected readonly info = computed(() => {
    const total = this.total();
    const start = total === 0 ? 0 : this.page() * this.pageSize() + 1;
    const end = Math.min((this.page() + 1) * this.pageSize(), total);
    let text = `Showing ${fmt(start)} to ${fmt(end)} of ${fmt(total)} entries`;
    const all = this.unfilteredTotal();
    if (all !== null && all !== total) {
      text += ` (filtered from ${fmt(all)} total entries)`;
    }
    return text;
  });

  constructor() {
    this.destroyRef.onDestroy(() => clearTimeout(this.searchTimer));
  }

  ngOnInit(): void {
    this.pageSize.set(this.pageLength());
    this.sortOrder.set(this.order());
    this.restoreState();
    this.ready = true;
    this.load();
  }

  // ── Public API for the host ────────────────────────────────────────────────────────────────

  /** Fetch again. Keeps the current page unless `resetPage` is set (DataTables `ajax.reload(null, resetPaging)`). */
  reload(resetPage = false): void {
    if (!this.ready) {
      return;
    }
    if (resetPage) {
      this.page.set(0);
    }
    this.load();
  }

  /**
   * Set the search term from outside (the header search box) and fetch, staying on the current
   * page, as `table.search(term); table.ajax.reload(null, false)` did.
   */
  search(term: string): void {
    if (!this.ready) {
      return;
    }
    clearTimeout(this.searchTimer);
    this.term.set(term ?? '');
    this.load();
  }

  // ── Template handlers ──────────────────────────────────────────────────────────────────────

  protected goTo(page: number): void {
    const target = Math.min(Math.max(0, page), this.pageCount() - 1);
    if (target === this.page()) {
      return;
    }
    this.page.set(target);
    this.load();
  }

  protected onLengthChange(event: Event): void {
    const size = Number((event.target as HTMLSelectElement).value);
    if (!size || size === this.pageSize()) {
      return;
    }
    this.pageSize.set(size);
    this.page.set(0);
    this.load();
  }

  protected onSearchInput(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => this.applySearch(value), SEARCH_DELAY_MS);
  }

  protected onSearchEnter(event: Event): void {
    clearTimeout(this.searchTimer);
    this.applySearch((event.target as HTMLInputElement).value);
  }

  protected onHeaderClick(index: number): void {
    const col = this.columns()[index];
    if (!col || !this.isSortable(col)) {
      return;
    }
    // Ascending first, then reversing on every further click. DataTables' default adds a third
    // "no order" state that left server-side paging unordered (#291, #336); never offer it.
    const current = this.sortOrder();
    const dir: SortDirection = current.column === index && current.dir === 'asc' ? 'desc' : 'asc';
    this.sortOrder.set({ column: index, dir });
    this.page.set(0);
    this.load();
  }

  protected onHeaderKey(event: Event, index: number): void {
    event.preventDefault();
    event.stopPropagation();
    this.onHeaderClick(index);
  }

  protected isSortable(col: TableColumn): boolean {
    return !!col.key && col.sortable !== false;
  }

  protected headerClasses(col: TableColumn, index: number): string {
    const classes: string[] = [];
    if (this.isSortable(col)) {
      classes.push('dt-orderable-asc', 'dt-orderable-desc');
      const current = this.sortOrder();
      if (current.column === index) {
        classes.push(current.dir === 'asc' ? 'dt-ordering-asc' : 'dt-ordering-desc');
      }
    } else {
      classes.push('dt-orderable-none');
    }
    if (col.headerClass) {
      classes.push(col.headerClass);
    }
    return classes.join(' ');
  }

  protected ariaSort(index: number): 'ascending' | 'descending' | null {
    const current = this.sortOrder();
    if (current.column !== index || !this.isSortable(this.columns()[index])) {
      return null;
    }
    return current.dir === 'asc' ? 'ascending' : 'descending';
  }

  protected sortLabel(col: TableColumn, index: number): string {
    const current = this.sortOrder();
    const next = current.column === index && current.dir === 'asc' ? 'descending' : 'ascending';
    return `${col.title}: Activate to sort ${next}`;
  }

  // ── Loading ────────────────────────────────────────────────────────────────────────────────

  private applySearch(term: string): void {
    if (term === this.term()) {
      return;
    }
    this.term.set(term);
    this.page.set(0);
    this.load();
  }

  private currentQuery(): TableQuery {
    const { column, dir } = this.sortOrder();
    const key = this.columns()[column]?.key;
    return {
      page: this.page(),
      size: this.pageSize(),
      sort: key ? [{ key, dir }] : [],
      term: this.term(),
    };
  }

  private load(): void {
    const token = this.draws.start();
    const query = this.currentQuery();
    this.loading.set(true);
    this.saveState();
    this.source()(query).then(
      result => {
        if (this.draws.isStale(token)) {
          return;
        }
        this.rows.set(result.rows);
        this.total.set(result.total);
        if (query.term === '') {
          this.unfilteredTotal.set(result.total);
        }
        this.loaded.set(true);
        this.loading.set(false);
      },
      (error: unknown) => {
        if (this.draws.isStale(token)) {
          return;
        }
        this.rows.set([]);
        this.total.set(0);
        this.loaded.set(true);
        this.loading.set(false);
        this.loadError.emit(error);
      },
    );
  }

  // ── State saving (DataTables `stateSave`) ──────────────────────────────────────────────────

  private stateKey(): string {
    return `cta-table_${this.tableId()}_${window.location.pathname}`;
  }

  private restoreState(): void {
    if (!this.persistState()) {
      return;
    }
    try {
      const raw = localStorage.getItem(this.stateKey());
      if (!raw) {
        return;
      }
      const saved = JSON.parse(raw) as Partial<SavedState>;
      if (typeof saved.time !== 'number' || Date.now() - saved.time > STATE_TTL_MS) {
        return;
      }
      if (typeof saved.size === 'number' && this.pageLengths().includes(saved.size)) {
        this.pageSize.set(saved.size);
      }
      if (typeof saved.page === 'number' && saved.page >= 0) {
        this.page.set(Math.floor(saved.page));
      }
      if (typeof saved.term === 'string') {
        this.term.set(saved.term);
      }
      const o = saved.order;
      const col = o ? this.columns()[o.column] : undefined;
      if (o && col && this.isSortable(col) && (o.dir === 'asc' || o.dir === 'desc')) {
        this.sortOrder.set({ column: o.column, dir: o.dir });
      }
    } catch {
      // Storage unavailable or the entry is corrupt: start from the defaults.
    }
  }

  private saveState(): void {
    if (!this.persistState()) {
      return;
    }
    try {
      const state: SavedState = {
        time: Date.now(),
        page: this.page(),
        size: this.pageSize(),
        term: this.term(),
        order: this.sortOrder(),
      };
      localStorage.setItem(this.stateKey(), JSON.stringify(state));
    } catch {
      // Private window or blocked storage: the table works, it just forgets.
    }
  }
}

function fmt(n: number): string {
  return n.toLocaleString('en-GB');
}
