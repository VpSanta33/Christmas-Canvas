import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";

// ESLint 9 扁平配置。仅对 src 下的 TS/TSX 生效，规则以 recommended 为基线，
// 叠加 React Hooks 正确性规则；prettier 负责格式，这里不做格式类规则以免二者打架。
export default tseslint.config(
    {
        ignores: ["dist", "build", "node_modules", "public", "*.config.*"],
    },
    js.configs.recommended,
    ...tseslint.configs.recommended,
    {
        files: ["src/**/*.{ts,tsx}"],
        languageOptions: {
            ecmaVersion: 2022,
            globals: { ...globals.browser, ...globals.es2021 },
        },
        plugins: {
            "react-hooks": reactHooks,
            "react-refresh": reactRefresh,
        },
        rules: {
            ...reactHooks.configs.recommended.rules,
            "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
            "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
            "@typescript-eslint/no-explicit-any": "off",
            // 首次接入 lint：保留高价值正确性规则为 error（下方 rules-of-hooks），
            // 其余 React Compiler 取向的严格新规先降为 warn，作为可渐进消化的基线，避免一次性阻断既有代码。
            "react-hooks/rules-of-hooks": "error",
            "react-hooks/exhaustive-deps": "warn",
            "react-hooks/set-state-in-effect": "warn",
            "react-hooks/immutability": "warn",
            "react-hooks/refs": "warn",
            "react-hooks/preserve-manual-memoization": "warn",
            "react-hooks/use-memo": "warn",
            "react-hooks/preserve-caught-error": "off",
            "preserve-caught-error": "off",
            "@typescript-eslint/no-unused-expressions": "warn",
        },
    },
);
