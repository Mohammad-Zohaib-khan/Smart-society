/**
 * Chooses the database the integration tests run against:
 *   TEST_DB=uri           → TEST_MONGODB_URI (e.g. a local or CI MongoDB)
 *   TEST_DB=memory-server → mongodb-memory-server, a real mongod binary (default)
 *   TEST_DB=wire-double   → in-process wire-protocol test double (only when mongod is unavailable)
 */
import type { TestProject } from 'vitest/node';

declare module 'vitest' {
  export interface ProvidedContext {
    mongoUri: string;
    dbMode: string;
  }
}

export default async function setup(project: TestProject) {
  const mode = process.env.TEST_DB ?? 'memory-server';
  let uri: string;
  let stop: () => Promise<unknown>;
  if (mode === 'uri') {
    if (!process.env.TEST_MONGODB_URI) throw new Error('TEST_DB=uri requires TEST_MONGODB_URI');
    uri = process.env.TEST_MONGODB_URI;
    stop = async () => undefined;
  } else if (mode === 'wire-double') {
    const { startMongoWireDouble } = await import('../support/mongo-wire-double.js');
    const dbl = await startMongoWireDouble();
    uri = dbl.uri;
    stop = dbl.stop;
  } else {
    const { MongoMemoryServer } = await import('mongodb-memory-server');
    const server = await MongoMemoryServer.create();
    uri = server.getUri();
    stop = () => server.stop();
  }
  console.log(`\n[integration tests] database mode: ${mode}${mode === 'wire-double' ? ' (TEST DOUBLE — not a real mongod)' : ''}\n`);
  project.provide('mongoUri', uri);
  project.provide('dbMode', mode);
  return async () => {
    await stop();
  };
}
