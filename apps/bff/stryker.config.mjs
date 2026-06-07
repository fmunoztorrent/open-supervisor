export default {
  packageManager: "pnpm",
  testRunner: "jest",
  plugins: ["@stryker-mutator/jest-runner", "@stryker-mutator/typescript-checker"],
  checkers: ["typescript"],
  tsconfigFile: "tsconfig.json",
  mutate: ["src/**/*.ts", "!src/**/*.spec.ts", "!src/**/__tests__/**"],
  reporters: ["progress", "clear-text", "html"],
  thresholds: { high: 80, low: 50, break: null },
  coverageAnalysis: "perTest",
};
