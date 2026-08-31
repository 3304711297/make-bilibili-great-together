import { readFile } from 'node:fs/promises';
import typescript from '@rollup/plugin-typescript';
import json from '@rollup/plugin-json';
import resolve from '@rollup/plugin-node-resolve';
import replace from '@rollup/plugin-replace';

// Fallback for the unavailable rollup-plugin-userscript@^0.6.0（brief 预裁定）：
// 内联插件读取 userscript.meta.json，生成 `// ==UserScript==` meta 头 banner 拼接在输出最前。
function userscript(metaFile) {
  let banner = '';
  return {
    name: 'userscript-meta',
    async buildStart() {
      const meta = JSON.parse(await readFile(metaFile, 'utf8'));
      const lines = Object.entries(meta).flatMap(([key, value]) =>
        (Array.isArray(value) ? value : [value]).map(v => `// @${key} ${v}`)
      );
      banner = `// ==UserScript==\n${lines.join('\n')}\n// ==/UserScript==\n`;
    },
    generateBundle(_options, bundle) {
      for (const chunk of Object.values(bundle)) {
        if (chunk.type === 'chunk') chunk.code = banner + chunk.code;
      }
    }
  };
}

export default {
  input: 'src/entry.ts',
  output: {
    file: 'dist/make-bilibili-great-together.user.js',
    format: 'iife',
    sourcemap: false
  },
  plugins: [
    resolve(),
    json(),
    userscript('./userscript.meta.json'),
    typescript({ tsconfig: './tsconfig.json' }),
    // core 模块内的 process.env.DEBUG 调试分支在浏览器/userscript 沙箱中不存在 Node 的 process，
    // 打包期替换为 false（与 userscript 形态下"无环境变量"语义一致）；须在 typescript 插件之后执行
    replace({ preventAssignment: true, values: { 'process.env.DEBUG': 'false' } })
  ]
};
