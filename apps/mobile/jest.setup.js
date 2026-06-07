jest.mock('react-native-sse', () => {
  const MockEventSource = jest.fn().mockImplementation(function () {
    this.addEventListener = jest.fn();
    this.removeEventListener = jest.fn();
    this.removeAllEventListeners = jest.fn();
    this.close = jest.fn();
  });
  return MockEventSource;
});

jest.mock('react-native-config', () => ({
  BFF_BASE_URL: 'http://localhost:3000',
}));

jest.mock('@react-native-async-storage/async-storage', () => {
  const store = {};
  return {
    getItem: jest.fn((key) => Promise.resolve(store[key] || null)),
    setItem: jest.fn((key, value) => {
      store[key] = value;
      return Promise.resolve();
    }),
    removeItem: jest.fn((key) => {
      delete store[key];
      return Promise.resolve();
    }),
    clear: jest.fn(() => {
      Object.keys(store).forEach((k) => delete store[k]);
      return Promise.resolve();
    }),
  };
});

jest.mock('jwt-decode', () => ({
  jwtDecode: jest.fn((token) => {
    if (token === 'expired-token') {
      return { sub: 'user-1', exp: Math.floor(Date.now() / 1000) - 3600 };
    }
    return {
      sub: '12345678-9',
      preferred_username: '12345678-9',
      storeId: 'store-1',
      displayName: 'Juan Pérez',
      exp: Math.floor(Date.now() / 1000) + 28800,
    };
  }),
}));

require('@testing-library/react-native/extend-expect');

// renderWithProvider — wraps render in GluestackUIProvider when available
const React = require('react');
const { render } = require('@testing-library/react-native');

let GluestackUIProvider = null;
let gluestackConfig = null;
try {
  const themed = require('@gluestack-ui/themed');
  const configPkg = require('@gluestack-ui/config');
  GluestackUIProvider = themed.GluestackUIProvider;
  gluestackConfig = configPkg.config;
} catch {
  // gluestack not installed yet — provider omitted in tests
}

global.renderWithProvider = (ui, options) => {
  if (GluestackUIProvider && gluestackConfig) {
    return render(
      React.createElement(GluestackUIProvider, { config: gluestackConfig }, ui),
      options
    );
  }
  return render(ui, options);
};
