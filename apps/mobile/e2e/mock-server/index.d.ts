import type { Server } from 'http';

export function startServer(port?: number): Promise<Server>;
export function stopServer(): Promise<void>;
