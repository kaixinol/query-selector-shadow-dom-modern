import typescript from '@rollup/plugin-typescript';

export default {
  input: 'src/index.ts',
  plugins: [
    typescript({
      tsconfig: false,
      target: 'ES2020',
      module: 'ES2020',
      moduleResolution: 'bundler',
      lib: ['ES2020', 'DOM'],
      declaration: false,
      strict: true,
      esModuleInterop: true,
      exclude: ['test/**', 'benchmark/**'],
    }),
  ],
  output: {
    format: 'umd',
    name: 'querySelectorShadowDom',
    file: 'dist/umd/index.js',
    sourcemap: true,
  },
};
