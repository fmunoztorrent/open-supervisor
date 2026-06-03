import Config from 'react-native-config';

const BASE_URL = Config.BFF_BASE_URL ?? 'http://localhost:3000';

export const bffClient = {
  baseUrl: BASE_URL,
  get: (path: string) =>
    fetch(`${BASE_URL}${path}`).then(res => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    }),
  post: (path: string, body: unknown) =>
    fetch(`${BASE_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then(res => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    }),
};
