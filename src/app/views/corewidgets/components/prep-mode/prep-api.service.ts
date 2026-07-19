import { Injectable } from '@angular/core';
import { Apollo } from 'apollo-angular';
import gql from 'graphql-tag';
import { firstValueFrom } from 'rxjs';
import { PrepKit, PrepQueueItem, PrepRequest } from './models';

/**
 * Talks to techaid-server's authenticated device-request / kit surface for the
 * prep-mode prototype. Uses the shared Apollo client (NOT HttpClient like the
 * public booking flow) so every request carries the operator's bearer token.
 *
 * Apollo v4 deep-freezes results; this service never mutates a result in place —
 * callers derive fresh objects. See the architecture contract §2.
 */

const QUEUE_QUERY = gql`
  query prepQueue($page: PaginationInput, $filter: DeviceRequestWhereInput!) {
    deviceRequestConnection(page: $page, where: $filter) {
      totalElements
      content {
        id
        collectionDate
        isPrepped
        clientRef
        referringOrganisationContact {
          id
          fullName
          referringOrganisation {
            id
            name
          }
        }
        deviceRequestItems {
          phones
          tablets
          laptops
          allInOnes
          desktops
          commsDevices
          other
          broadbandHubs
        }
      }
    }
  }
`;

const REQUEST_QUERY = gql`
  query prepRequest($id: Long) {
    deviceRequest(where: { id: { _eq: $id } }) {
      id
      status
      isPrepped
      isSales
      clientRef
      borough
      details
      collectionDate
      collectionMethod
      collectionContactName
      deviceRequestItems {
        phones
        tablets
        laptops
        allInOnes
        desktops
        commsDevices
        other
        broadbandHubs
      }
      referringOrganisationContact {
        id
        fullName
        referringOrganisation {
          id
          name
        }
      }
      kits {
        id
        type
        make
        model
        status
      }
      deviceRequestNotes {
        id
        content
        volunteer
        createdAt
        updatedAt
      }
    }
  }
`;

const KIT_QUERY = gql`
  query prepKit($id: Long) {
    kit(where: { id: { _eq: $id } }) {
      id
      type
      make
      model
      status
    }
  }
`;

const ASSIGN_KITS = gql`
  mutation assignKitsToDeviceRequest($data: BulkKitAssignmentInput!) {
    assignKitsToDeviceRequest(data: $data) {
      id
      kits {
        id
      }
    }
  }
`;

const UPDATE_ENTITY = gql`
  mutation updateDeviceRequest($data: UpdateDeviceRequestInput!) {
    updateDeviceRequest(data: $data) {
      id
      isPrepped
    }
  }
`;

export interface QueueRange {
  /** ISO instant, inclusive lower bound on collectionDate. */
  startISO: string;
  /** ISO instant, inclusive upper bound on collectionDate. */
  endISO: string;
  /** When true, only requests that are not yet prepped are returned. */
  unpreppedOnly: boolean;
}

@Injectable()
export class PrepApiService {
  constructor(private readonly apollo: Apollo) {}

  /**
   * The queue filter for a day/week range. Ordered collectionDate asc then id asc
   * by the caller's page sort. Default is unprepped-only.
   *
   * PRODUCT DECISION: unprepped-only uses `isPrepped: { _in: [false] }`, which
   * excludes requests whose `isPrepped` is null (never set). Whether "unprepped"
   * should also sweep in null-flagged requests is undecided; `_in:[false]` matches
   * the established device-request-index filter op and is the safe known-working shape.
   */
  buildQueueFilter(range: QueueRange): Record<string, unknown> {
    const and: Record<string, unknown>[] = [
      { collectionDate: { _gte: range.startISO } },
      { collectionDate: { _lte: range.endISO } },
    ];
    if (range.unpreppedOnly) {
      and.push({ isPrepped: { _in: [false] } });
    }
    return { AND: and };
  }

  async loadQueue(range: QueueRange): Promise<PrepQueueItem[]> {
    const res = await firstValueFrom(
      this.apollo.query<{ deviceRequestConnection: { content: PrepQueueItem[] } }>({
        query: QUEUE_QUERY,
        // network-only: the queue must reflect isPrepped writes made during this session.
        fetchPolicy: 'network-only',
        variables: {
          page: {
            // Order collectionDate first, then id, so the queue is a stable walk.
            sort: [
              { key: 'collectionDate', value: 'asc' },
              { key: 'id', value: 'asc' },
            ],
            // Prototype: one page big enough to hold a day/week of requests.
            size: 500,
            page: 0,
          },
          filter: this.buildQueueFilter(range),
        },
      }),
    );
    return res.data?.deviceRequestConnection?.content ?? [];
  }

  async loadRequest(id: string | number): Promise<PrepRequest | null> {
    const res = await firstValueFrom(
      this.apollo.query<{ deviceRequest: PrepRequest }>({
        query: REQUEST_QUERY,
        fetchPolicy: 'network-only',
        variables: { id: Number(id) },
      }),
    );
    return res.data?.deviceRequest ?? null;
  }

  async loadKit(id: string | number): Promise<PrepKit | null> {
    const res = await firstValueFrom(
      this.apollo.query<{ kit: PrepKit }>({
        query: KIT_QUERY,
        fetchPolicy: 'network-only',
        variables: { id: Number(id) },
      }),
    );
    return res.data?.kit ?? null;
  }

  /**
   * Assign a single kit to a request via the bulk mutation (single-element batch).
   * Returns the assigned kit ids the server reports so the caller can confirm the
   * scanned id actually landed.
   */
  async assignKit(requestId: string | number, kitId: string | number): Promise<string[]> {
    const res = await firstValueFrom(
      this.apollo.mutate<{ assignKitsToDeviceRequest: { kits: { id: string }[] } }>({
        mutation: ASSIGN_KITS,
        variables: {
          data: {
            deviceRequestId: Number(requestId),
            kitIds: [String(kitId)],
          },
        },
      }),
    );
    return (res.data?.assignKitsToDeviceRequest?.kits ?? []).map((k) => String(k.id));
  }

  /**
   * Set `isPrepped: true` on a request.
   *
   * ⚠️ `updateDeviceRequest` is FULL-REPLACE on the server (architecture contract
   * §10): any field omitted from the input is cleared. So we must send the complete
   * update payload rebuilt from a freshly-fetched request, flipping only isPrepped —
   * mirroring exactly the field set device-request-info's form.value produces, no
   * more, no less. We refetch here rather than trust a possibly-stale caller copy.
   */
  async markPrepped(requestId: string | number): Promise<void> {
    const fresh = await this.loadRequest(requestId);
    if (!fresh) {
      throw new Error(`Device request ${requestId} could not be loaded to mark prepped.`);
    }
    const data = this.buildPreppedUpdateInput(fresh);
    await firstValueFrom(
      this.apollo.mutate({
        mutation: UPDATE_ENTITY,
        variables: { data },
      }),
    );
  }

  /**
   * Build the full-replace UpdateDeviceRequestInput from a fresh request, flipping
   * isPrepped to true. The field set is a faithful copy of what
   * device-request-info.component.ts sends on a normal save (its Formly form.value):
   *
   *   id, status, isPrepped, clientRef, borough, details,
   *   deviceRequestItems.{laptops,phones,tablets,allInOnes,desktops,commsDevices,
   *                       broadbandHubs,other},
   *   referringOrganisationContactId (from referringOrganisationContact.id),
   *   collectionDate (ISO or null), collectionMethod, collectionContactName,
   *   deviceRequestNote.content ('' — the empty-note the form always sends),
   *   isSales
   *
   * Anything device-request-info does NOT send (e.g. deviceRequestNeeds) is
   * deliberately omitted here too, so prep-mode's save is byte-for-byte the same
   * surface as a normal edit and cannot wipe a field that normal edits preserve.
   */
  private buildPreppedUpdateInput(req: PrepRequest): Record<string, unknown> {
    const items = req.deviceRequestItems;
    return {
      id: Number(req.id),
      status: req.status,
      isPrepped: true,
      clientRef: req.clientRef ?? '',
      borough: req.borough ?? '',
      details: req.details ?? '',
      deviceRequestItems: {
        laptops: items?.laptops ?? 0,
        phones: items?.phones ?? 0,
        tablets: items?.tablets ?? 0,
        allInOnes: items?.allInOnes ?? 0,
        desktops: items?.desktops ?? 0,
        commsDevices: items?.commsDevices ?? 0,
        broadbandHubs: items?.broadbandHubs ?? 0,
        other: items?.other ?? 0,
      },
      referringOrganisationContactId: req.referringOrganisationContact?.id
        ? Number(req.referringOrganisationContact.id)
        : null,
      // Server returns an ISO instant; normalise the same way device-request-info does.
      collectionDate: req.collectionDate ? new Date(req.collectionDate).toISOString() : null,
      collectionMethod: req.collectionMethod ?? null,
      collectionContactName: req.collectionContactName ?? null,
      // device-request-info always includes the new-note field, empty when unused.
      deviceRequestNote: { content: '' },
      isSales: req.isSales ?? false,
    };
  }
}
