'use strict';

/**
 * Mock server para tests Detox E2E de open-supervisor.
 *
 * Simula el BFF (apps/bff) con los mismos contratos HTTP que la app espera.
 * Los endpoints /test/* son exclusivos para controlar el estado desde beforeAll/afterAll.
 *
 * Puerto: 3001 (fijo — configurado en .env.e2e y .detoxrc.js reversePorts)
 */

const express = require('express');
const jwt = require('jsonwebtoken');
const path = require('path');

const JWT_SECRET = 'e2e-test-secret-not-for-production';
const VALID_EMPLOYEE_ID = 'e2e-supervisor';
const VALID_PASSWORD = 'test1234';
const STORE_ID = 'store-e2e';

// Estado mutable compartido entre endpoints
let currentPending = [];
// Clientes SSE conectados: Map<storeId, Set<Response>>
const sseClients = new Map();

function getSseClients(storeId) {
  if (!sseClients.has(storeId)) {
    sseClients.set(storeId, new Set());
  }
  return sseClients.get(storeId);
}

function createApp() {
  const app = express();
  app.use(express.json());

  // ── Auth ────────────────────────────────────────────────────────────────────

  /**
   * POST /auth/login
   * Body: { employeeId: string, password: string }
   * 200: { access_token: string }  — JWT con claims requeridos por SessionContext
   * 401: { message: 'Credenciales inválidas' }
   */
  app.post('/auth/login', (req, res) => {
    const { employeeId, password } = req.body ?? {};

    if (employeeId !== VALID_EMPLOYEE_ID || password !== VALID_PASSWORD) {
      return res.status(401).json({ message: 'Credenciales inválidas' });
    }

    const now = Math.floor(Date.now() / 1000);
    const payload = {
      sub: 'user-e2e-001',
      preferred_username: employeeId,
      storeId: STORE_ID,
      displayName: 'E2E Supervisor',
      exp: now + 8 * 60 * 60, // 8 horas desde ahora — generado en runtime
    };

    const access_token = jwt.sign(payload, JWT_SECRET);
    const refresh_token = jwt.sign({ sub: payload.sub, type: 'refresh' }, JWT_SECRET, { expiresIn: '30d' });
    return res.status(200).json({ access_token, refresh_token, expires_in: 28800 });
  });

  // ── Solicitudes pendientes ───────────────────────────────────────────────────

  /**
   * GET /authorization/store/:storeId/pending
   * 200: AuthorizationRequestDto[]
   */
  app.get('/authorization/store/:storeId/pending', (req, res) => {
    return res.status(200).json(currentPending);
  });

  /**
   * POST /authorization/:id/resolve
   * Body: { decision: 'APPROVE' | 'REJECT', supervisor_id: string }
   * 200: { status: 'APPROVED' | 'REJECTED', correlation_id: string }
   * Elimina la solicitud resuelta de currentPending.
   */
  app.post('/authorization/:id/resolve', (req, res) => {
    const correlationId = req.params.id;
    const { decision } = req.body ?? {};

    // Eliminar de la lista de pendientes
    currentPending = currentPending.filter(
      (r) => r.correlation_id !== correlationId,
    );

    const status = decision === 'APPROVE' ? 'APPROVED' : 'REJECTED';
    return res.status(200).json({ status, correlation_id: correlationId });
  });

  // ── SSE ──────────────────────────────────────────────────────────────────────

  /**
   * GET /stream/store/:storeId
   * Mantiene la conexión SSE abierta. El emulador accede a localhost:3001 gracias
   * a reversePorts en .detoxrc.js (adb reverse tcp:3001 tcp:3001).
   */
  app.get('/stream/store/:storeId', (req, res) => {
    const { storeId } = req.params;

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.flushHeaders();

    // Enviar comentario inicial para confirmar la conexión
    res.write(': connected\n\n');

    const clients = getSseClients(storeId);
    clients.add(res);

    req.on('close', () => {
      clients.delete(res);
    });
  });

  // ── Endpoints de control (solo para tests) ──────────────────────────────────

  /**
   * POST /test/seed
   * Body: AuthorizationRequestDto[]
   * Reemplaza currentPending con el array recibido.
   */
  app.post('/test/seed', (req, res) => {
    const body = req.body;
    currentPending = Array.isArray(body) ? body : [];
    return res.status(200).json({ seeded: currentPending.length });
  });

  /**
   * POST /test/emit-sse
   * Body: AuthorizationRequestDto
   * Emite un evento SSE a todos los clientes conectados del storeId del payload.
   * El hook useSSERequests escucha exactamente el evento 'authorization_request'.
   */
  app.post('/test/emit-sse', (req, res) => {
    const request = req.body;
    const storeId = request?.store_id ?? STORE_ID;

    const clients = getSseClients(storeId);
    const data = JSON.stringify(request);
    const sseMessage = `event: authorization_request\ndata: ${data}\n\n`;

    for (const client of clients) {
      client.write(sseMessage);
    }

    return res.status(200).json({ emitted: clients.size });
  });

  /**
   * POST /test/reset
   * Vacía currentPending y cierra todas las conexiones SSE activas.
   */
  app.post('/test/reset', (req, res) => {
    currentPending = [];

    for (const [, clients] of sseClients) {
      for (const client of clients) {
        client.end();
      }
      clients.clear();
    }
    sseClients.clear();

    return res.status(200).json({ reset: true });
  });

  return app;
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

let server = null;

/**
 * Arranca el mock server en el puerto indicado.
 * Exportado para uso en beforeAll de las suites Detox.
 */
function startServer(port = 3001) {
  return new Promise((resolve, reject) => {
    const app = createApp();
    server = app.listen(port, '0.0.0.0', (err) => {
      if (err) return reject(err);
      console.log(`[mock-server] Corriendo en http://0.0.0.0:${port}`);
      resolve(server);
    });
    server.on('error', reject);
  });
}

/**
 * Detiene el mock server.
 * Exportado para uso en afterAll de las suites Detox.
 */
function stopServer() {
  return new Promise((resolve, reject) => {
    if (!server) return resolve();
    server.close((err) => {
      server = null;
      if (err) return reject(err);
      console.log('[mock-server] Detenido.');
      resolve();
    });
  });
}

module.exports = { startServer, stopServer };

// Arranque directo (para desarrollo manual: node index.js)
if (require.main === module) {
  startServer(3001).catch((err) => {
    console.error('[mock-server] Error al arrancar:', err);
    process.exit(1);
  });
}
