import { Injectable } from '@angular/core';
import { Apollo } from 'apollo-angular';
import gql from 'graphql-tag';
import { firstValueFrom } from 'rxjs';

/**
 * GraphQL surface for the Update Scanner. Uses the shared Apollo client so every
 * request carries the operator's bearer token.
 *
 * Both operations already existed: `updateKits` is the bulk mutation behind the
 * Devices page's Bulk Update modal (called here with a single-id array), and the
 * lookup is `kit-info`'s `findKit` narrowed to the confirming context plus the
 * blocking sub-status flags. The lookup is named `scannerKit` rather than
 * `findKit` purely so mocks and server logs can tell scanner traffic apart from
 * the detail page's — same convention as prep-mode's `prepKit`.
 *
 * Apollo v4 deep-freezes results; nothing here mutates a result in place.
 */

const SCANNER_KIT_QUERY = gql`
  query scannerKit($id: Long) {
    kit(where: { id: { _eq: $id } }) {
      id
      make
      model
      status
      archived
      subStatus {
        wipeFailed
        installationOfOSFailed
        needsFurtherInvestigation
        needsSparePart
        lockedToUser
      }
    }
  }
`;

const UPDATE_KITS = gql`
  mutation updateKits($ids: [ID!]!, $status: KitStatus) {
    updateKits(data: { ids: $ids, status: $status }) {
      id
      status
    }
  }
`;

/** The sub-status flags that block the QC and Assessment statuses. */
export interface ScannerKitSubStatus {
  wipeFailed?: boolean | null;
  installationOfOSFailed?: boolean | null;
  needsFurtherInvestigation?: boolean | null;
  needsSparePart?: boolean | null;
  lockedToUser?: boolean | null;
}

export interface ScannerKit {
  id: string;
  make?: string | null;
  model?: string | null;
  status: string;
  archived?: boolean | null;
  subStatus?: ScannerKitSubStatus | null;
}

@Injectable()
export class KitScannerApiService {
  constructor(private readonly apollo: Apollo) {}

  /**
   * Look up a scanned device. `network-only` is deliberate: rescanning a device
   * during a session must read its real current status, not the copy cached
   * before the previous scan changed it.
   */
  async findKit(id: number): Promise<ScannerKit | null> {
    const res = await firstValueFrom(
      this.apollo.query<{ kit: ScannerKit | null }>({
        query: SCANNER_KIT_QUERY,
        variables: { id },
        fetchPolicy: 'network-only',
        errorPolicy: 'none',
      }),
    );
    return res.data?.kit ?? null;
  }

  /** Apply `status` to a single device via the existing bulk mutation. */
  async applyStatus(id: number, status: string): Promise<{ id: string; status: string } | null> {
    const res = await firstValueFrom(
      this.apollo.mutate<{ updateKits: { id: string; status: string }[] }>({
        mutation: UPDATE_KITS,
        variables: { ids: [String(id)], status },
        errorPolicy: 'none',
      }),
    );
    const updated = res.data?.updateKits ?? [];
    return updated.find(k => String(k.id) === String(id)) ?? updated[0] ?? null;
  }
}
