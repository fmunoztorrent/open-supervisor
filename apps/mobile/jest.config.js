module.exports = {
  preset: 'react-native',
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
  transform: {
    '^.+\\.(js|jsx|ts|tsx)$': 'babel-jest',
  },
  transformIgnorePatterns: [
    'node_modules/(?!(.pnpm|react-native|@react-native|@react-native-async-storage|react-native-sse|react-native-config|react-native-url-polyfill|react-native-svg|@gluestack-ui|@gluestack-style|@legendapp|@expo)/)',
  ],
  moduleNameMapper: {
    '@open-supervisor/shared-types': '<rootDir>/../../packages/shared-types/src/index.ts',
    '@open-supervisor/shared-messaging': '<rootDir>/../../packages/shared-messaging/src/index.ts',
  },
  setupFilesAfterEnv: ['./jest.setup.js'],
  testRegex: 'src/.*\\.test\\.(ts|tsx)$',
};
