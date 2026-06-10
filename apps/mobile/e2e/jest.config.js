/**
 * jest.config.js — Runner Jest dedicado para los tests Detox E2E.
 *
 * Completamente separado del jest.config.js de los tests unitarios RNTL
 * que vive en apps/mobile/jest.config.js.
 *
 * Invocado por el script `detox:test` en package.json via:
 *   detox test --configuration android.emu.debug --jest-config e2e/jest.config.js
 *
 * NOTA FASE RED: Los tests fallarán porque 'detox' no está instalado.
 * El runner globalSetup/globalTeardown de Detox no podrá resolverse.
 */

/** @type {import('@jest/types').Config.InitialOptions} */
module.exports = {
  rootDir: '..',
  testMatch: ['<rootDir>/e2e/**/*.test.ts'],
  testTimeout: 120000,
  maxWorkers: 1,
  globalSetup: 'detox/runners/jest/globalSetup',
  globalTeardown: 'detox/runners/jest/globalTeardown',
  reporters: ['detox/runners/jest/reporter'],
  testEnvironment: 'detox/runners/jest/testEnvironment',
  verbose: true,
  transform: {
    '^.+\\.tsx?$': [
      'babel-jest',
      {
        presets: [
          ['@babel/preset-env', { targets: { node: 'current' } }],
          '@babel/preset-typescript',
        ],
      },
    ],
  },
};
