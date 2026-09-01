import typescript from '@rollup/plugin-typescript';
import resolve from '@rollup/plugin-node-resolve';
import replace from '@rollup/plugin-replace';

// 多入口 + IIFE 不能共用一次 code-splitting 构建（rollup 限制）：
// 每个入口独立构建为自包含 IIFE，与 manifest.json 的 js 文件名一一对应
const plugins = [
  resolve(),
  typescript({ tsconfig: './tsconfig.json' }),
  // core 模块内的 process.env.DEBUG 调试分支在浏览器 MAIN world/扩展环境中不存在 Node 的 process，
  // 打包期替换为 false（与 userscript 包同策略）；须在 typescript 插件之后执行
  replace({ preventAssignment: true, values: { 'process.env.DEBUG': 'false' } })
];

export default [
  { input: 'src/main-entry.ts', output: { file: 'dist/main.js', format: 'iife', sourcemap: false }, plugins },
  { input: 'src/isolated-entry.ts', output: { file: 'dist/isolated.js', format: 'iife', sourcemap: false }, plugins },
  { input: 'src/options.ts', output: { file: 'dist/options.js', format: 'iife', sourcemap: false }, plugins },
  { input: 'src/background-entry.ts', output: { file: 'dist/background.js', format: 'iife', sourcemap: false }, plugins }
];
