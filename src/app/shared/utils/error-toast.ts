/**
 * Error toasts with an error ref (#381, part d).
 *
 * Every toast that reports a failed GraphQL operation goes through `toastError` / `toastWarning`
 * (or `errorToastText` for a caller that shows the text some other way). They show friendly text
 * where the server's text is not meant for people, the server's own words where it is, and the
 * operation's ref (`refForError`, the `X-CTA-Ref` the request carried), so a staff member can quote
 * "Ref: ABCD2345" and support can find both the browser's and the server's log rows.
 *
 * Toasts are plain text: `enableHtml` is always off, so nothing the server sends is rendered as
 * markup.
 *
 * ## Deliberate or unexpected: the rule
 *
 * The server (techaid-server `CustomErrorHandlerConfig`) sends three kinds of GraphQL error text:
 *  - deliberate messages from dedicated handlers (`@GraphQlExceptionHandler`: request and
 *    membership limits, BlockingFlagSetException, wipe-cert, booking refusals, referee erased),
 *    all with `extensions.classification` BAD_REQUEST;
 *  - for a signed-in caller, the raw message of ANY other exception (classification
 *    DataFetchingException). Some are deliberate ("Unable to locate a kit with id: 42", "You
 *    cannot delete other user's notes"), some are leaked internals (SQL, constraint names, NPEs);
 *  - bean-validation text, "<method>.<arg>.<field>: must not be blank, ...", for everyone.
 *
 * So, per error:
 *  1. Validation: a message shaped like `a.b.field: constraint` (ConstraintViolationException) is
 *     rewritten as "Please check the details entered: field must not be blank." (field name and
 *     the constraint only; these describe the caller's own input, never another record).
 *  2. Unexpected, shown as "Something went wrong." (or the caller's own fallback):
 *     - a transport failure, or anything that is not a GraphQL error response (network: "Could not
 *       reach the server...", HTTP status: "The server could not complete the request...");
 *     - classification ValidationError / InvalidSyntax / INTERNAL_ERROR / ExecutionAborted /
 *       OperationNotSupported (a broken query or an unhandled server failure, never a message
 *       meant for people);
 *     - a message that looks technical: Java/Kotlin package names, "Exception", SQL fragments,
 *       NPE wording, the server's anonymous GENERIC_MESSAGE (it carries the same ref), a line
 *       break, or more than MAX_DELIBERATE_LENGTH characters.
 *  3. Deliberate, shown as written: classification BAD_REQUEST (only dedicated handlers use it, so
 *     the technical-shape check is skipped), and everything else that is a short, one-line, human
 *     sentence. FORBIDDEN, UNAUTHORIZED, NOT_FOUND and "Access Denied" land here.
 * If any error of a response is unexpected the toast is the unexpected text; otherwise the
 * validation and deliberate texts are joined. graphql-java's non-null bubbling companion error is
 * ignored when another error is present.
 *
 * Kept free of Angular (the ToastrService import is type-only) so a plain Node test can import it.
 * Callers that PARSE messages (org-request's limit page, BookingApiError) keep reading the raw
 * error; this only changes what is displayed.
 */
import type { IndividualConfig, ToastrService } from 'ngx-toastr';
import { refForError } from './error-ref';

export const UNEXPECTED_TEXT = 'Something went wrong.';
export const NETWORK_TEXT = 'Could not reach the server. Please check your connection and try again.';
export const SERVER_STATUS_TEXT = 'The server could not complete the request. Please try again in a minute.';
export const VALIDATION_PREFIX = 'Please check the details entered:';
/** Longer than this and a message is a dump, not a sentence written for people (#38). */
export const MAX_DELIBERATE_LENGTH = 300;

/** Classifications that never carry a message written for people. */
const UNEXPECTED_CLASSIFICATIONS = new Set([
  'ValidationError', // the query itself does not match the schema: a dashboard bug
  'InvalidSyntax',
  'INTERNAL_ERROR', // Spring's default for an unresolved exception ("INTERNAL_ERROR for <id>")
  'ExecutionAborted',
  'OperationNotSupported',
]);

/** graphql-java's companion error when a non-null field bubbled up a null. */
const NULL_BUBBLE_CLASSIFICATION = 'NullValueInNonNullableField';
const NULL_BUBBLE_RE = /was declared as a non null type/;

/** "updatePost.data.title: must not be blank" — one ConstraintViolation, path then message. */
const VIOLATION_RE = /([A-Za-z_$][\w$]*(?:\.[\w$<>\[\]]+)+):\s*([^,]+?)(?=,\s*[A-Za-z_$][\w$]*(?:\.[\w$<>\[\]]+)+:|$)/g;
const VIOLATION_SHAPE_RE = /^[A-Za-z_$][\w$]*(?:\.[\w$<>\[\]]+)+:\s/;

/** Text shapes that only internals produce. */
const TECHNICAL_RES: RegExp[] = [
  /\b(?:java|javax|jakarta|kotlin|org|com|cta|graphql|io|net)\.[a-z_]\w*\.[A-Za-z_]/, // package names
  /[a-z]Exception\b|\bat [\w$.]+\(/,
  /\bSQL\b|could not execute|duplicate key|violates [\w ]*constraint|\bJDBC\b|Hibernate|insert into/i,
  /Cannot invoke "|NullPointer|non-null is null|lateinit property/,
  /INTERNAL_ERROR for /,
  /^Something went wrong\. Please try again - /, // the server's GENERIC_MESSAGE (same ref)
  /[\r\n]/,
];

export type ErrorKind = 'network' | 'server-status' | 'unexpected' | 'validation' | 'deliberate';

export interface DescribedError {
  kind: ErrorKind;
  /** What to show, without the ref. */
  text: string;
  /** The operation's ref, or undefined when it never reached the API. */
  ref?: string;
}

export interface ErrorTextOptions {
  /** Replaces UNEXPECTED_TEXT (e.g. a public page's own "please try again" copy). */
  unexpected?: string;
  /** Put before the text, e.g. "The global settings were saved, but the matrix was not: ". */
  prefix?: string;
}

interface GraphQLErrorLike {
  message?: unknown;
  extensions?: { classification?: unknown };
}

/** The GraphQL `errors` of an Apollo CombinedGraphQLErrors / CombinedProtocolErrors, or of a non-2xx body. */
function graphQLErrorsOf(err: unknown): GraphQLErrorLike[] | undefined {
  if (!err || typeof err !== 'object') {
    return undefined;
  }
  const e = err as { name?: unknown; errors?: unknown; bodyText?: unknown; error?: unknown };
  if ((e.name === 'CombinedGraphQLErrors' || e.name === 'CombinedProtocolErrors') && Array.isArray(e.errors)) {
    return e.errors as GraphQLErrorLike[];
  }
  // A non-2xx response may still carry a GraphQL envelope (Apollo ServerError.bodyText, or
  // Angular HttpErrorResponse.error). Only an actual envelope counts.
  const body = e.name === 'HttpErrorResponse' ? e.error : e.bodyText;
  let parsed: unknown = body;
  if (typeof body === 'string') {
    try {
      parsed = JSON.parse(body);
    } catch {
      return undefined;
    }
  }
  const errors = (parsed as { errors?: unknown } | null)?.errors;
  return Array.isArray(errors) && errors.length ? (errors as GraphQLErrorLike[]) : undefined;
}

function statusOf(err: unknown): number | undefined {
  const e = err as { status?: unknown; statusCode?: unknown } | null;
  const status = e?.statusCode ?? e?.status;
  return typeof status === 'number' ? status : undefined;
}

function isTransport(err: unknown): boolean {
  const name = (err as { name?: unknown } | null)?.name;
  return name === 'HttpErrorResponse' || name === 'ServerError' || name === 'ServerParseError'
    || statusOf(err) !== undefined;
}

/** "firstName" -> "first name", "data[0].email" -> "email". */
function fieldLabel(path: string): string {
  const last = path.split('.').pop() ?? path;
  return last.replace(/[<>\[\]\d]/g, '').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase() || 'a field';
}

function validationText(message: string): string | undefined {
  if (!VIOLATION_SHAPE_RE.test(message)) {
    return undefined;
  }
  const parts: string[] = [];
  for (const match of message.matchAll(VIOLATION_RE)) {
    parts.push(`${fieldLabel(match[1])} ${match[2].trim()}`);
  }
  return parts.length ? parts.slice(0, 3).join('; ') : undefined;
}

/** Classifies `err` and picks the text to show for it (see the rule in the header). */
export function describeError(err: unknown, options: ErrorTextOptions = {}): DescribedError {
  const ref = refForError(err);
  const unexpected: DescribedError = { kind: 'unexpected', text: options.unexpected ?? UNEXPECTED_TEXT, ref };
  let errors = graphQLErrorsOf(err);

  if (!errors) {
    if (!isTransport(err)) {
      return unexpected;
    }
    const status = statusOf(err);
    return status && status > 0
      ? { kind: 'server-status', text: SERVER_STATUS_TEXT, ref }
      : { kind: 'network', text: NETWORK_TEXT, ref };
  }

  const isBubble = (e: GraphQLErrorLike) => e?.extensions?.classification === NULL_BUBBLE_CLASSIFICATION
    || (typeof e?.message === 'string' && NULL_BUBBLE_RE.test(e.message));
  if (errors.some(e => !isBubble(e))) {
    errors = errors.filter(e => !isBubble(e));
  }

  const texts: string[] = [];
  let validation = false;
  for (const error of errors) {
    const message = typeof error?.message === 'string' ? error.message.trim() : '';
    const classification = error?.extensions?.classification;
    if (typeof classification === 'string' && UNEXPECTED_CLASSIFICATIONS.has(classification)) {
      return unexpected;
    }
    if (classification === 'BAD_REQUEST' && message && !VIOLATION_SHAPE_RE.test(message)) {
      // A dedicated server handler wrote this for people (limits, booking refusals, guards).
      texts.push(message);
      continue;
    }
    if (TECHNICAL_RES.some(re => re.test(message))) {
      return unexpected;
    }
    const fields = validationText(message);
    if (fields) {
      validation = true;
      texts.push(fields);
      continue;
    }
    if (!message || message.length > MAX_DELIBERATE_LENGTH) {
      return unexpected;
    }
    texts.push(message);
  }
  if (!texts.length) {
    return unexpected;
  }
  const unique = [...new Set(texts)];
  return validation
    ? { kind: 'validation', text: `${VALIDATION_PREFIX} ${unique.join('; ')}.`, ref }
    : { kind: 'deliberate', text: unique.map(sentence).join(' '), ref };
}

/** Ends a message with a full stop if it has no closing punctuation, so the ref reads cleanly. */
function sentence(text: string): string {
  return /[.!?)]$/.test(text) ? text : `${text}.`;
}

/** "Unable to locate a kit with id: 42. Ref: ABCD2345" — the full toast body, plain text. */
export function errorToastText(err: unknown, options: ErrorTextOptions = {}): string {
  const described = describeError(err, options);
  return withRef(`${options.prefix ?? ''}${described.text}`, described.ref);
}

/** Appends " Ref: XXXX" when there is a ref. For callers that already have their own text. */
export function withRef(text: string, ref: string | undefined): string {
  return ref ? `${sentence(text.trim())} Ref: ${ref}` : text;
}

export type ErrorToastOptions = Partial<IndividualConfig> & ErrorTextOptions;

function show(
  level: 'error' | 'warning',
  toastr: ToastrService,
  err: unknown,
  title: string,
  options: ErrorToastOptions,
): void {
  const { unexpected, prefix, ...config } = options;
  toastr[level](errorToastText(err, { unexpected, prefix }), title, { ...config, enableHtml: false });
}

/** An error toast for a failed operation: friendly or deliberate text plus the ref, never HTML. */
export function toastError(toastr: ToastrService, err: unknown, title = 'Error', options: ErrorToastOptions = {}): void {
  show('error', toastr, err, title, options);
}

/** As toastError, as a warning toast (the load-failure toasts use warnings). */
export function toastWarning(toastr: ToastrService, err: unknown, title = 'Error', options: ErrorToastOptions = {}): void {
  show('warning', toastr, err, title, options);
}
