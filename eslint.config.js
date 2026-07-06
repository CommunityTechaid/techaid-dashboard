// @ts-check
const { defineConfig } = require("eslint/config");
const eslint = require("@eslint/js");
const tseslint = require("typescript-eslint");
const angular = require("angular-eslint");

module.exports = defineConfig([
  {
    ignores: [
      ".angular/**",
      "dist/**",
      "node_modules/**",
      "playwright-report/**",
      "test-results/**",
      "e2e/.auth/**",
      "build/**",
      "workers/**",
      "server.js",
    ],
  },
  {
    files: ["**/*.ts"],
    extends: [
      eslint.configs.recommended,
      tseslint.configs.recommended,
      tseslint.configs.stylistic,
      angular.configs.tsRecommended,
    ],
    processor: angular.processInlineTemplates,
    rules: {
      // `const self = this;` inside function-scoped jQuery/datepicker callbacks
      // is intentional in this codebase.
      "@typescript-eslint/no-this-alias": [
        "error",
        { allowedNames: ["self", "that"] },
      ],

      // --- Legacy-debt baseline (July 2026 hygiene retrofit) -----------------
      // These rules flag long-standing patterns across the pre-existing code
      // (~1100 hits). They are downgraded to warnings so the CI error gate
      // starts green while keeping the debt visible. Burn down opportunistically
      // when touching a file; avoid adding new violations.
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "warn",
      "@angular-eslint/prefer-inject": "warn",
      "@typescript-eslint/no-empty-function": "warn",
      "no-empty": "warn",
      "no-useless-escape": "warn",
      // Legacy indexed for-loops and Object.prototype.hasOwnProperty calls
      // are scattered through the same older utility/service files; low
      // count, but not worth mass-editing outside their own PR.
      "@typescript-eslint/prefer-for-of": "warn",
      "no-prototype-builtins": "warn",
      // Angular lifecycle overrides intentionally left empty (interface
      // conformance stubs), same root cause as no-empty-function above.
      "@angular-eslint/no-empty-lifecycle-method": "warn",
      // Autofix left one `let` that ESLint's control-flow analysis can't
      // prove is never reassigned across a try/catch; not worth a targeted
      // source edit for a single site.
      "prefer-const": "warn",
    },
  },
  {
    files: ["**/*.html"],
    extends: [
      angular.configs.templateRecommended,
      angular.configs.templateAccessibility,
    ],
    rules: {
      // --- Legacy-debt baseline (July 2026 hygiene retrofit) -----------------
      // `==` in templates mostly compares loosely-typed GraphQL/DataTables
      // values (e.g. `total != 0`); converting blindly to `===` can change
      // behavior, so it stays a warning until each site is verified.
      "@angular-eslint/template/eqeqeq": "warn",
      // Accessibility fixes (tabindex, alt text, label wiring, key handlers)
      // need per-template UX decisions — tracked as warnings for a follow-up.
      "@angular-eslint/template/interactive-supports-focus": "warn",
      "@angular-eslint/template/click-events-have-key-events": "warn",
      "@angular-eslint/template/alt-text": "warn",
      "@angular-eslint/template/label-has-associated-control": "warn",
      // The codebase is uniformly *ngIf/*ngFor; migrate to @if/@for wholesale
      // in a dedicated pass, not two templates at a time.
      "@angular-eslint/template/prefer-control-flow": "warn",
    },
  },
]);
