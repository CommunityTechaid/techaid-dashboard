/** One column of a native table. `key` is the server-side sort field. */
export interface TableColumn {
  title: string;
  /** Sort field sent to the API. A column with no key (or `sortable: false`) cannot be sorted. */
  key?: string;
  sortable?: boolean;
  width?: string;
  headerClass?: string;
  /** Tooltip on the header cell (the `title` attribute). */
  hint?: string;
  /**
   * Render the host's `<ng-template ctaHeader>` in place of the title (for a header that holds a
   * control, such as a select-all checkbox). `title` is still the accessible name when it is not empty.
   */
  custom?: boolean;
}

export type SortDirection = 'asc' | 'desc';

export interface TableSort {
  key: string;
  dir: SortDirection;
}

/** What the shell asks the host for. `page` is zero-based. */
export interface TableQuery {
  page: number;
  size: number;
  sort: TableSort[];
  term: string;
}

/** What the host answers with. `total` is the count matching `term` (the server's `totalElements`). */
export interface TableResult<T> {
  rows: readonly T[];
  total: number;
}

export type TableSource<T> = (query: TableQuery) => Promise<TableResult<T>>;

/** Initial order: index into `columns`, as DataTables' `order: [0, 'desc']` did. */
export interface TableOrder {
  column: number;
  dir: SortDirection;
}

export type PagingType = 'simple_numbers' | 'full_numbers';

export type PageItem = number | 'ellipsis';

/**
 * Page buttons to show, as DataTables' pager does: all of them when they fit in `buttons`
 * slots, otherwise the first and last page with an ellipsis on each side the current page is
 * away from. Pages are zero-based.
 */
export function pageNumbers(current: number, pages: number, buttons = 7): PageItem[] {
  const range = (from: number, to: number): number[] => Array.from({ length: Math.max(0, to - from) }, (_, i) => from + i);
  const half = Math.floor(buttons / 2);
  if (pages <= buttons) {
    return range(0, pages);
  }
  if (current <= half) {
    return [...range(0, buttons - 2), 'ellipsis', pages - 1];
  }
  if (current >= pages - 1 - half) {
    return [0, 'ellipsis', ...range(pages - (buttons - 2), pages)];
  }
  return [0, 'ellipsis', ...range(current - half + 2, current + half - 1), 'ellipsis', pages - 1];
}

/**
 * Client-side mode: a `source` over rows the host already holds, for tables with no server
 * paging (the dashboard's status table). `rows` is read on every request, so a host passing a
 * signal reads its current value; `accessors` maps each sortable column `key` to the cell value
 * used for ordering and searching.
 *
 * Matches DataTables' client-side defaults: the search is case-insensitive and "smart" (every
 * whitespace-separated word must appear somewhere in the row), strings sort case-insensitively
 * and numbers numerically, and the sort is stable.
 */
export function clientSource<T>(
  rows: () => readonly T[],
  accessors: Record<string, (row: T) => string | number>,
): TableSource<T> {
  return async (query: TableQuery): Promise<TableResult<T>> => {
    const words = query.term.toLowerCase().split(/\s+/).filter(Boolean);
    const text = (row: T) => Object.values(accessors).map(get => String(get(row))).join(' ').toLowerCase();
    const matching = rows().filter(row => {
      const haystack = text(row);
      return words.every(w => haystack.includes(w));
    });
    const sort = query.sort[0];
    const get = sort ? accessors[sort.key] : undefined;
    const compare = (a: string | number, b: string | number): number => {
      if (typeof a === 'number' && typeof b === 'number') {
        return a - b;
      }
      const x = String(a).toLowerCase();
      const y = String(b).toLowerCase();
      return x < y ? -1 : x > y ? 1 : 0;
    };
    const ordered = get
      ? matching
          .map((row, i) => ({ row, i, v: get(row) }))
          .sort((a, b) => (sort.dir === 'asc' ? compare(a.v, b.v) : -compare(a.v, b.v)) || a.i - b.i)
          .map(x => x.row)
      : matching;
    const start = query.page * query.size;
    return { rows: ordered.slice(start, start + query.size), total: ordered.length };
  };
}
