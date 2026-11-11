/** One column of a native table. `key` is the server-side sort field. */
export interface TableColumn {
  title: string;
  /** Sort field sent to the API. A column with no key (or `sortable: false`) cannot be sorted. */
  key?: string;
  sortable?: boolean;
  width?: string;
  headerClass?: string;
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
