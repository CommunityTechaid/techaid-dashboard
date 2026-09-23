/**
 * Drops out-of-order DataTables server-side responses before they reach component state.
 *
 * Every table component renders its rows from `this.entities`, assigned in the DataTables
 * `ajax` callback when the GraphQL query resolves. Queries resolve in whatever order the
 * network returns them, so a slow, older search could land after a newer one and overwrite
 * its rows — the table showed results for a term that was no longer in the search box.
 * DataTables' own `draw` counter already discards stale draws for its info label and paging,
 * but that protection never reached the component's own state.
 *
 * Usage, one per table:
 *
 *   private readonly draws = new LatestDraw();
 *   ajax: (params, callback) => {
 *     const drawToken = this.draws.start();
 *     queryRef.refetch(vars).then(res => {
 *       if (this.draws.isStale(drawToken)) return;   // a newer draw is in flight or done
 *       this.entities = ...;
 *       callback({ draw: params.draw, ... });
 *     });
 *   }
 *
 * Returning without calling `callback` is safe: DataTables ignores any draw older than the
 * newest one it has seen, and the newer draw's own callback clears the processing state.
 *
 * The token is our own counter, not DataTables' `params.draw`: `draw` restarts at 1 whenever a
 * table is re-initialised, which would make every later response look stale forever.
 *
 * Regression cover: e2e/tests/stale-search-response.spec.ts.
 */
export class LatestDraw {
  private latest = 0;

  /** Call as a request starts; returns the token to check when its response arrives. */
  start(): number {
    return ++this.latest;
  }

  /** True when a newer request has started since the one holding `token`. */
  isStale(token: number): boolean {
    return token !== this.latest;
  }
}
