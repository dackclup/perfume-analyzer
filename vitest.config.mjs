// Vitest config — runs the pure-utility tests in lib/. The HTML files
// stay out of the test target since their inline scripts depend on a
// live DOM and the data layer (PERFUMERY_DATA). Algorithms shared
// between tests and the page live in lib/utils.mjs.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.{js,mjs,ts}'],
    environment: 'node',
    globals: false,
    reporters: 'default'
  }
});
