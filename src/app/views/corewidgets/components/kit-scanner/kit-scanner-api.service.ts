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

/**
 * The note-carrying variant, sent ONLY when the operator has typed a session
 * note. Two documents rather than one with a nullable `$note`, because
 * `BulkKitUpdateInput.note` is newer than this page: against a server that
 * predates it the document fails GraphQL validation outright, which would
 * break every scan rather than just the note. Splitting it means an ordinary
 * note-free session keeps working if the dashboard ever reaches an
 * environment ahead of its API.
 */
const UPDATE_KITS_WITH_NOTE = gql`
  mutation updateKitsWithNote($ids: [ID!]!, $status: KitStatus, $note: CreateNoteInput) {
    updateKits(data: { ids: $ids, status: $status, note: $note }) {
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

  /**
   * Apply `status` to a single device via the existing bulk mutation, and —
   * when the operator has set a session note — append that note to the device
   * in the same mutation, so a device can never end up with the status change
   * but not its note.
   */
  async applyStatus(
    id: number,
    status: string,
    note?: string | null,
  ): Promise<{ id: string; status: string } | null> {
    const res = await firstValueFrom(
      this.apollo.mutate<{ updateKits: { id: string; status: string }[] }>({
        mutation: note ? UPDATE_KITS_WITH_NOTE : UPDATE_KITS,
        variables: note
          ? { ids: [String(id)], status, note: { content: note } }
          : { ids: [String(id)], status },
        errorPolicy: 'none',
      }),
    );
    const updated = res.data?.updateKits ?? [];
    return updated.find(k => String(k.id) === String(id)) ?? updated[0] ?? null;
  }
}
