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

// AsyncStorage no tiene NativeModules en el entorno de Jest → usar el mock
// oficial del paquete. Requerido por hooks como useLogout que lo importan.
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

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
