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

require('@testing-library/react-native/extend-expect');
