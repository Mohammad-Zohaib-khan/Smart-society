/**
 * Runs the wire-protocol TEST DOUBLE as a standalone server so the API can be exercised
 * end-to-end in environments without MongoDB. Data lives in memory and is lost on exit.
 *   npx tsx test/support/run-double.ts 27099
 */
import { startMongoWireDouble } from './mongo-wire-double.js';

const port = Number(process.argv[2] ?? 27099);
const dbl = await startMongoWireDouble(port);
console.log(`MongoDB wire TEST DOUBLE listening at ${dbl.uri} (in-memory, not a real database)`);
