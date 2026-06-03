// Exposes the Node.js `global` object to TypeScript so tests can write
// `global.fetch = jest.fn()` without a type error.
// The `globalThis` type is available from ES2020 and includes `fetch`
// via the react-native lib types.
declare var global: typeof globalThis;
