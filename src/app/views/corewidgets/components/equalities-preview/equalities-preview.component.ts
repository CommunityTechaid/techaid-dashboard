import { ChangeDetectionStrategy, Component, HostListener, OnDestroy, OnInit, computed, signal } from '@angular/core';
import { Meta } from '@angular/platform-browser';
import { ActivatedRoute } from '@angular/router';
import { AppLocalCSS } from '../org-request/app-local-css.component';
import { EQUALITIES_INTRO, EQUALITIES_QUESTIONS, EqualitiesQuestion } from './equalities-questions';

/**
 * PROTOTYPE — a native rebuild of the Typeform equalities form, for demoing on UAT only.
 *
 * Reachable solely by its unlisted URL (nothing in the app links to it) and blocked on
 * production by nonProductionGuard. It sends nothing anywhere: no GraphQL call, no
 * storage. The answers are special category data, so the end-state design forwards them
 * to the isolated Google Sheet without TaDa persisting them; this page only shows the
 * payload that would be forwarded.
 *
 * Hidden fields mirror the Typeform embed: ?corr_id=&borough=&ward=
 */
@Component({
  selector: 'app-equalities-preview',
  standalone: true,
  imports: [AppLocalCSS],
  templateUrl: './equalities-preview.component.html',
  styleUrl: './equalities-preview.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EqualitiesPreviewComponent implements OnInit, OnDestroy {
  readonly intro = EQUALITIES_INTRO;
  readonly letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

  /** -1 = welcome screen, otherwise an index into `visibleQuestions`. */
  readonly position = signal(-1);
  readonly submitted = signal(false);
  readonly answers = signal<Record<string, string>>({});
  hidden: { corr_id: string; borough: string; ward: string } = { corr_id: '', borough: '', ward: '' };

  readonly visibleQuestions = computed(() => {
    const a = this.answers();
    return EQUALITIES_QUESTIONS.filter((q) => !q.skipWhen || a[q.skipWhen.key] !== q.skipWhen.equals);
  });
  readonly current = computed<EqualitiesQuestion | undefined>(() => this.visibleQuestions()[this.position()]);
  readonly isLast = computed(() => this.position() === this.visibleQuestions().length - 1);
  readonly progress = computed(() => {
    const qs = this.visibleQuestions();
    const a = this.answers();
    return Math.round((qs.filter((q) => a[q.key]).length / qs.length) * 100);
  });
  /** What a real submission would forward: hidden fields + answers for the questions actually shown. */
  readonly payload = computed(() => {
    const a = this.answers();
    return {
      hidden: this.hidden,
      answers: this.visibleQuestions().map((q) => ({ ref: q.ref, question: q.title, answer: a[q.key] ?? '' })),
    };
  });

  private advanceTimer?: ReturnType<typeof setTimeout>;

  constructor(
    private readonly route: ActivatedRoute,
    private readonly meta: Meta,
  ) {}

  ngOnInit(): void {
    const p = this.route.snapshot.queryParamMap;
    this.hidden = { corr_id: p.get('corr_id') ?? '', borough: p.get('borough') ?? '', ward: p.get('ward') ?? '' };
    this.meta.updateTag({ name: 'robots', content: 'noindex, nofollow' });
  }

  ngOnDestroy(): void {
    clearTimeout(this.advanceTimer);
    this.meta.removeTag('name="robots"');
  }

  start(): void {
    this.position.set(0);
  }

  choose(choice: string): void {
    const q = this.current();
    if (!q) return;
    this.answers.update((a) => ({ ...a, [q.key]: choice }));
    clearTimeout(this.advanceTimer);
    if (!this.isLast()) {
      // Typeform-style auto-advance, with a beat so the selection is visibly confirmed.
      this.advanceTimer = setTimeout(() => this.next(), 350);
    }
  }

  next(): void {
    const q = this.current();
    if (!q || !this.answers()[q.key]) return;
    if (this.isLast()) {
      this.submit();
    } else {
      this.position.update((i) => i + 1);
    }
  }

  back(): void {
    clearTimeout(this.advanceTimer);
    this.position.update((i) => Math.max(-1, i - 1));
  }

  submit(): void {
    if (this.visibleQuestions().some((q) => !this.answers()[q.key])) return;
    this.submitted.set(true);
  }

  restart(): void {
    this.answers.set({});
    this.submitted.set(false);
    this.position.set(-1);
  }

  @HostListener('document:keydown', ['$event'])
  onKey(e: KeyboardEvent): void {
    if (this.submitted() || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'Enter') {
      if (this.position() === -1) this.start();
      else this.next();
      return;
    }
    const q = this.current();
    if (!q || e.key.length !== 1) return;
    const idx = this.letters.indexOf(e.key.toUpperCase());
    if (idx >= 0 && idx < q.choices.length) this.choose(q.choices[idx]);
  }
}
