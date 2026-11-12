/**
 * Polyfills loaded before the app. The app targets evergreen browsers only, so there are no
 * language polyfills here; only the i18n runtime that @angular/localize requires.
 */
import '@angular/localize/init';

/* zone.js was removed in #115: the app runs with provideZonelessChangeDetection(). */
