// eslint 扁平配置。在 brief 原文基础上的必要微调（取能跑通者）：
// 1. 引入 typescript-eslint 的 parser/plugin——源码全部为 .ts，espree 无法解析 TS 语法，
//    且 brief 规则表中的 '@typescript-eslint/no-explicit-any' 需要插件声明才能解析。
// 2. no-unused-vars 采用 @typescript-eslint 版本并容忍 `_` 前缀未用参数/变量
//    （logger.ts 的 noop 形参签名即 (..._: unknown[])，Task 2 裁定保留）。
// 3. 关闭 no-undef：TS 类型系统已覆盖，且 userscript 全局（GM_* / unsafeWindow）无 JS 运行时定义。
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default [
  { ignores: ['**/dist/**', '**/node_modules/**'] },
  eslint.configs.recommended,
  {
    files: ['**/*.ts'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      parser: tseslint.parser
    },
    plugins: { '@typescript-eslint': tseslint.plugin },
    rules: {
      'no-console': 'off',
      'no-undef': 'off',
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn'
    }
  }
];
