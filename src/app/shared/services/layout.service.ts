import { DOCUMENT } from '@angular/common';
import { Injectable, OnDestroy, Renderer2, RendererFactory2, inject } from '@angular/core';

/** Viewport width (px) below which the sidebar is collapsed. Matches Bootstrap's `md` breakpoint. */
export const SIDEBAR_BREAKPOINT = 768;

/** Scroll distance (px) after which the scroll-to-top button appears. */
export const SCROLL_TOP_THRESHOLD = 100;

/**
 * Page-chrome behaviour that used to live in `src/sb-admin-2.min.js` (jQuery): the collapsed sidebar
 * (`body.sidebar-toggled`) and the scroll-to-top button. The CSS hooks are unchanged
 * (`.sidebar-toggled .sidebar` in styles.css, `.scroll-to-top` in sb-admin.css).
 *
 * Behaviours carried over from the script:
 *  - below 768px the sidebar starts collapsed; at 768px and up it is shown,
 *  - a window resize re-applies that rule (so it also *expands* when going back up),
 *  - scrolling on a phone collapses the sidebar again,
 *  - the scroll-to-top button shows after 100px of scroll,
 *  - the button scrolls smoothly back to the top.
 * The header's phone button toggles the sidebar through {@link toggleSidebar}.
 */
@Injectable({ providedIn: 'root' })
export class LayoutService implements OnDestroy {
  private readonly doc = inject(DOCUMENT);
  private readonly renderer: Renderer2 = inject(RendererFactory2).createRenderer(null, null);
  private unlisten: (() => void)[] = [];

  /** Apply the initial state and start listening. Idempotent; called once by the root component. */
  init(): void {
    if (this.unlisten.length) {
      return;
    }
    this.applyViewportRule();
    this.unlisten.push(
      this.renderer.listen('window', 'resize', () => this.applyViewportRule()),
      this.renderer.listen(this.doc, 'scroll', () => this.onScroll()),
    );
    this.updateScrollButton();
  }

  toggleSidebar(): void {
    this.doc.body.classList.toggle('sidebar-toggled');
  }

  scrollToTop(): void {
    this.doc.defaultView?.scrollTo({ top: 0, behavior: 'smooth' });
  }

  ngOnDestroy(): void {
    this.unlisten.forEach(fn => fn());
    this.unlisten = [];
  }

  private get width(): number {
    // clientWidth excludes the scrollbar, like jQuery's $(window).width() did.
    return this.doc.documentElement.clientWidth;
  }

  private applyViewportRule(): void {
    this.doc.body.classList.toggle('sidebar-toggled', this.width < SIDEBAR_BREAKPOINT);
  }

  private onScroll(): void {
    if (this.width < SIDEBAR_BREAKPOINT) {
      this.doc.body.classList.add('sidebar-toggled');
    }
    this.updateScrollButton();
  }

  private updateScrollButton(): void {
    const view = this.doc.defaultView;
    const distance = view?.scrollY ?? 0;
    const button = this.doc.querySelector<HTMLElement>('.scroll-to-top');
    if (button) {
      button.style.display = distance > SCROLL_TOP_THRESHOLD ? 'block' : 'none';
    }
  }
}
