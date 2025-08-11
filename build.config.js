import { defineBuildConfig } from 'unbuild';

export default defineBuildConfig({
  entries: [
    { input: 'src/', outDir: 'dist', format: 'cjs' },
  ],
  clean: true,
  rollup: false,
  declaration: true,
  failOnWarn: false,
});

