/**
 * Naming for the real UAT records the Batch 5 write-flow specs create.
 *
 * Every sample record carries E2E_SAMPLE_MARKER in its primary searchable
 * field, plus an entity label and a run-unique timestamp:
 *
 *   sampleName('Donor')  ->  "Donor E2E Sample 1783412935277"
 *
 * Why this shape:
 *   - the entity label ("Donor", "Kit", "Org", "Referee", "Request") lets a
 *     human scanning a UAT list tell one kind of sample from another;
 *   - E2E_SAMPLE_MARKER is a SINGLE key shared by every entity, so all test
 *     residue is findable in one query regardless of type — search any list
 *     for "E2E Sample", or run `npm run e2e:cleanup`;
 *   - the trailing timestamp keeps names unique across runs and narrows a
 *     DataTables search to exactly one row.
 *
 * Records are still hard-deleted first by the teardown helper; the marker is
 * what makes leftover residue (from a crashed run, or created by a token that
 * can only archive) identifiable and bulk-removable later.
 */
export const E2E_SAMPLE_MARKER = 'E2E Sample';

/** e.g. sampleName('Donor') -> "Donor E2E Sample <timestamp>". */
export function sampleName(entity: string, stamp: number = Date.now()): string {
  return `${entity} ${E2E_SAMPLE_MARKER} ${stamp}`;
}

/**
 * e.g. sampleEmail('Request') -> "request-e2e-sample-<timestamp>@example.org".
 *
 * Same entity + marker + stamp as sampleName, but slugified. Do NOT build an address by
 * lowercasing sampleName() directly: that leaves spaces in the local part, which
 * jakarta.mail's InternetAddress rejects. Until techaid-server added @Email validation the
 * API stored such addresses verbatim, and they then made the server's stale-intake sweeper
 * throw mid-batch — re-sending "Device Request Declined" emails to a real referee once per
 * sweep for 13 days (techaid-server PR #83).
 */
export function sampleEmail(
  entity: string,
  stamp: number = Date.now(),
  domain = 'example.org',
): string {
  return `${sampleName(entity, stamp).toLowerCase().replace(/\s+/g, '-')}@${domain}`;
}
