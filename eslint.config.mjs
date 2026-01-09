import opinionated from 'opinionated-eslint-config';

export default opinionated().append({
  // Don't want to lint test assets or templates
  ignores: [ 'test/assets/*', 'componentsjs-error-state.json', 'templates/**/*.ts' ],
});
