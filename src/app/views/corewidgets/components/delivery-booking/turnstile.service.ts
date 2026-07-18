import { Injectable } from '@angular/core';

/**
 * Minimal typing for the parts of the Cloudflare Turnstile browser API we use.
 * Keeps `any` out of the component that consumes it.
 */
interface TurnstileRenderOptions {
  sitekey: string;
  callback?: (token: string) => void;
  'expired-callback'?: () => void;
  'error-callback'?: () => void;
}

interface TurnstileApi {
  render(container: string | HTMLElement, options: TurnstileRenderOptions): string;
  reset(widgetId?: string): void;
  remove(widgetId?: string): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
    __ctaTurnstileOnload?: () => void;
  }
}

/**
 * Lazily injects Cloudflare Turnstile's script only on the booking page.
 * We deliberately do NOT add the script to index.html so authenticated admin
 * sessions never download or run Cloudflare's JS.
 */
@Injectable({ providedIn: 'root' })
export class TurnstileService {
  private loadPromise: Promise<void> | null = null;

  /**
   * Injects the Turnstile script exactly once (explicit-render mode) and resolves
   * when Cloudflare invokes the global onload callback. Subsequent calls reuse the
   * cached promise.
   */
  load(): Promise<void> {
    if (this.loadPromise) {
      return this.loadPromise;
    }

    this.loadPromise = new Promise<void>((resolve, reject) => {
      // Already available (e.g. navigated back to the page after a previous load).
      if (window.turnstile) {
        resolve();
        return;
      }

      window.__ctaTurnstileOnload = () => {
        resolve();
      };

      const script = document.createElement('script');
      script.src =
        'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=__ctaTurnstileOnload';
      script.async = true;
      script.defer = true;
      script.onerror = () => reject(new Error('Failed to load Cloudflare Turnstile.'));
      document.head.appendChild(script);
    });

    return this.loadPromise;
  }

  /**
   * Renders a widget into the given container. Returns the widget id used by reset().
   */
  render(
    container: HTMLElement,
    siteKey: string,
    onToken: (token: string) => void,
    onExpired: () => void,
  ): string {
    if (!window.turnstile) {
      throw new Error('Turnstile is not loaded yet.');
    }
    return window.turnstile.render(container, {
      sitekey: siteKey,
      callback: onToken,
      'expired-callback': onExpired,
      'error-callback': onExpired,
    });
  }

  reset(widgetId: string): void {
    window.turnstile?.reset(widgetId);
  }
}
