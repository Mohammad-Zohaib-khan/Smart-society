/**
 * MongoDB wire-protocol TEST DOUBLE.
 *
 * Why this exists: the sandbox this project was built in cannot download MongoDB binaries
 * (egress policy), so `mongodb-memory-server` cannot start a real `mongod` there. To still run
 * the API integration suite through the *real* Mongoose + MongoDB Node driver, this file speaks
 * the wire protocol (OP_QUERY handshake + OP_MSG) and evaluates queries/updates/aggregations with
 * `mingo`, enforcing unique and partial-unique indexes like mongod does.
 *
 * It is NOT a database and is never used outside tests. On a normal machine the test harness
 * prefers a real `mongod` (see test/setup/global-db.ts). Results produced against this double are
 * labelled as such in the test output.
 */
import net from 'node:net';
import { BSON, ObjectId, type Document } from 'bson';
import { Aggregator, Query } from 'mingo';
import { update as applyUpdate } from 'mingo/updater';

const OP_REPLY = 1;
const OP_QUERY = 2004;
const OP_MSG = 2013;
const OID = '\u0000oid:';

type Doc = Record<string, unknown>;

interface IndexSpec {
  name: string;
  key: Record<string, number | string>;
  unique: boolean;
  sparse: boolean;
  partialFilterExpression?: Doc;
}

interface Collection {
  docs: Doc[];
  indexes: IndexSpec[];
}

class CommandError extends Error {
  constructor(
    message: string,
    readonly code: number,
    readonly codeName: string,
    readonly extra: Doc = {},
  ) {
    super(message);
  }
}

// ------------------------------------------------------------------ value conversion

/** ObjectIds become tagged strings internally so mingo compares/sorts them by value. */
function toInternal(value: unknown): unknown {
  if (value instanceof ObjectId) return OID + value.toHexString();
  if (value instanceof Date || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(toInternal);
  if ((value as { _bsontype?: string })._bsontype) return value; // other BSON types kept as-is
  const out: Doc = {};
  for (const [k, v] of Object.entries(value as Doc)) out[k] = toInternal(v);
  return out;
}

function toExternal(value: unknown): unknown {
  if (typeof value === 'string' && value.startsWith(OID)) return ObjectId.createFromHexString(value.slice(OID.length));
  if (value instanceof Date || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(toExternal);
  if ((value as { _bsontype?: string })._bsontype) return value;
  const out: Doc = {};
  for (const [k, v] of Object.entries(value as Doc)) out[k] = toExternal(v);
  return out;
}

function clone<T>(v: T): T {
  return structuredClone(v);
}

function getPath(doc: Doc, path: string): unknown {
  let cur: unknown = doc;
  for (const part of path.split('.')) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Doc)[part];
  }
  return cur;
}

function isOperatorObject(v: unknown): boolean {
  return v !== null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date) && Object.keys(v).some((k) => k.startsWith('$'));
}

// ------------------------------------------------------------------ the store

class Store {
  private dbs = new Map<string, Map<string, Collection>>();

  collection(db: string, name: string, create = true): Collection | undefined {
    let d = this.dbs.get(db);
    if (!d) {
      if (!create) return undefined;
      d = new Map();
      this.dbs.set(db, d);
    }
    let c = d.get(name);
    if (!c && create) {
      c = { docs: [], indexes: [{ name: '_id_', key: { _id: 1 }, unique: true, sparse: false }] };
      d.set(name, c);
    }
    return c;
  }

  allCollections(db: string): Map<string, Collection> {
    return this.dbs.get(db) ?? new Map();
  }

  dropDatabase(db: string): void {
    this.dbs.delete(db);
  }

  dropCollection(db: string, name: string): boolean {
    return this.dbs.get(db)?.delete(name) ?? false;
  }
}

function indexApplies(index: IndexSpec, doc: Doc): boolean {
  if (index.partialFilterExpression && !new Query(index.partialFilterExpression, {}).test(doc)) return false;
  if (index.sparse && Object.keys(index.key).every((k) => getPath(doc, k) === undefined)) return false;
  return true;
}

function keyValue(index: IndexSpec, doc: Doc): Doc {
  const kv: Doc = {};
  for (const k of Object.keys(index.key)) kv[k] = getPath(doc, k) ?? null;
  return kv;
}

/** Throws a DuplicateKey error if `candidate` would violate a unique index. */
function checkUnique(dbName: string, collName: string, coll: Collection, candidate: Doc, ignore?: Doc): void {
  for (const index of coll.indexes) {
    if (!index.unique || !indexApplies(index, candidate)) continue;
    const kv = keyValue(index, candidate);
    const serial = JSON.stringify(kv);
    const clash = coll.docs.find((d) => d !== ignore && indexApplies(index, d) && JSON.stringify(keyValue(index, d)) === serial);
    if (clash) {
      const ext = toExternal(kv) as Doc;
      throw new CommandError(
        `E11000 duplicate key error collection: ${dbName}.${collName} index: ${index.name} dup key: ${JSON.stringify(kv)}`,
        11000,
        'DuplicateKey',
        { keyPattern: index.key, keyValue: ext },
      );
    }
  }
}

function sortDocs(docs: Doc[], sort: Doc | undefined): Doc[] {
  if (!sort || Object.keys(sort).length === 0) return docs;
  return new Aggregator([{ $sort: sort }], {}).run(docs) as Doc[];
}

function project(docs: Doc[], projection: Doc | undefined): Doc[] {
  if (!projection || Object.keys(projection).length === 0) return docs;
  return new Aggregator([{ $project: projection }], {}).run(docs) as Doc[];
}

/** Applies an update document (operators or replacement) to a copy of `doc`. */
function updatedCopy(doc: Doc, update: Doc | Doc[], isInsert: boolean, arrayFilters?: Doc[]): Doc {
  if (Array.isArray(update)) {
    const [out] = new Aggregator(update, {}).run([clone(doc)]) as Doc[];
    return out ?? clone(doc);
  }
  const keys = Object.keys(update);
  if (!keys.some((k) => k.startsWith('$'))) {
    return { ...clone(update), _id: doc._id };
  }
  const copy = clone(doc);
  const { $setOnInsert, ...rest } = update as Doc & { $setOnInsert?: Doc };
  const modifier: Doc = { ...rest };
  if (isInsert && $setOnInsert) modifier.$set = { ...((modifier.$set as Doc | undefined) ?? {}), ...$setOnInsert };
  if (Object.keys(modifier).length > 0) {
    applyUpdate(copy, modifier as never, arrayFilters, undefined, { cloneMode: 'deep' });
  }
  if (doc._id !== undefined) copy._id = doc._id;
  return copy;
}

/** Seed document for an upsert: equality fields from the filter. */
function upsertSeed(filter: Doc): Doc {
  const seed: Doc = {};
  for (const [k, v] of Object.entries(filter)) {
    if (k.startsWith('$')) {
      if (k === '$and' && Array.isArray(v)) for (const part of v) Object.assign(seed, upsertSeed(part as Doc));
      continue;
    }
    if (isOperatorObject(v)) {
      if ('$eq' in (v as Doc)) seed[k] = (v as Doc).$eq;
      continue;
    }
    if (k.includes('.')) {
      const parts = k.split('.');
      let cur = seed;
      for (const p of parts.slice(0, -1)) cur = (cur[p] ??= {}) as Doc;
      cur[parts.at(-1) as string] = v;
    } else seed[k] = v;
  }
  return seed;
}

// ------------------------------------------------------------------ command handlers

class CommandRunner {
  private connectionCounter = 0;
  constructor(private readonly store: Store) {}

  nextConnectionId(): number {
    return ++this.connectionCounter;
  }

  hello(connectionId: number): Doc {
    return {
      helloOk: true,
      ismaster: true,
      isWritablePrimary: true,
      maxBsonObjectSize: 16 * 1024 * 1024,
      maxMessageSizeBytes: 48_000_000,
      maxWriteBatchSize: 100_000,
      localTime: new Date(),
      logicalSessionTimeoutMinutes: 30,
      connectionId,
      minWireVersion: 0,
      maxWireVersion: 21,
      readOnly: false,
      ok: 1,
    };
  }

  run(cmd: Doc, connectionId: number): Doc {
    const name = Object.keys(cmd)[0] ?? '';
    const db = String(cmd.$db ?? 'admin');
    const lname = name.toLowerCase();
    switch (lname) {
      case 'hello':
      case 'ismaster':
        return this.hello(connectionId);
      case 'ping':
      case 'endsessions':
      case 'killcursors':
      case 'aborttransaction':
        return { ok: 1 };
      case 'buildinfo':
        return { version: '7.0.0-test-double', versionArray: [7, 0, 0, 0], ok: 1 };
      case 'getparameter':
        return { ok: 1 };
      case 'insert':
        return this.insert(db, cmd);
      case 'find':
        return this.find(db, cmd);
      case 'getmore':
        return { cursor: { nextBatch: [], id: 0n, ns: `${db}.${String(cmd.collection)}` }, ok: 1 };
      case 'update':
        return this.update(db, cmd);
      case 'delete':
        return this.delete(db, cmd);
      case 'findandmodify':
        return this.findAndModify(db, cmd);
      case 'aggregate':
        return this.aggregate(db, cmd);
      case 'count':
        return this.count(db, cmd);
      case 'distinct':
        return this.distinct(db, cmd);
      case 'createindexes':
        return this.createIndexes(db, cmd);
      case 'listindexes':
        return this.listIndexes(db, cmd);
      case 'dropindexes':
        return { ok: 1 };
      case 'create':
        this.store.collection(db, String(cmd.create));
        return { ok: 1 };
      case 'drop':
        if (!this.store.dropCollection(db, String(cmd.drop))) throw new CommandError('ns not found', 26, 'NamespaceNotFound');
        return { ok: 1 };
      case 'dropdatabase':
        this.store.dropDatabase(db);
        return { ok: 1 };
      case 'listcollections':
        return {
          cursor: {
            firstBatch: [...this.store.allCollections(db).keys()].map((n) => ({ name: n, type: 'collection', options: {}, info: { readOnly: false } })),
            id: 0n,
            ns: `${db}.$cmd.listCollections`,
          },
          ok: 1,
        };
      default:
        throw new CommandError(`no such command: '${name}' (test double)`, 59, 'CommandNotFound');
    }
  }

  private insert(db: string, cmd: Doc): Doc {
    const collName = String(cmd.insert);
    const coll = this.store.collection(db, collName) as Collection;
    const docs = (cmd.documents as Doc[]).map((d) => toInternal(d) as Doc);
    let n = 0;
    const writeErrors: Doc[] = [];
    for (const [index, doc] of docs.entries()) {
      if (doc._id === undefined) doc._id = OID + new ObjectId().toHexString();
      try {
        checkUnique(db, collName, coll, doc);
        coll.docs.push(doc);
        n++;
      } catch (e) {
        if (!(e instanceof CommandError)) throw e;
        writeErrors.push({ index, code: e.code, errmsg: e.message, ...e.extra });
        if (cmd.ordered !== false) break;
      }
    }
    return writeErrors.length ? { n, writeErrors, ok: 1 } : { n, ok: 1 };
  }

  private matching(coll: Collection, filter: Doc | undefined): Doc[] {
    const q = new Query(toInternal(filter ?? {}) as Doc, {});
    return coll.docs.filter((d) => q.test(d));
  }

  private find(db: string, cmd: Doc): Doc {
    const collName = String(cmd.find);
    const coll = this.store.collection(db, collName, false);
    let docs = coll ? this.matching(coll, cmd.filter as Doc) : [];
    docs = sortDocs(docs, toInternal(cmd.sort) as Doc | undefined);
    const skip = Number(cmd.skip ?? 0);
    const limit = Math.abs(Number(cmd.limit ?? 0));
    docs = docs.slice(skip, limit ? skip + limit : undefined);
    docs = project(docs.map(clone), cmd.projection as Doc | undefined);
    return { cursor: { firstBatch: docs.map(toExternal), id: 0n, ns: `${db}.${collName}` }, ok: 1 };
  }

  private update(db: string, cmd: Doc): Doc {
    const collName = String(cmd.update);
    const coll = this.store.collection(db, collName) as Collection;
    let n = 0;
    let nModified = 0;
    const upserted: Doc[] = [];
    const writeErrors: Doc[] = [];
    for (const [index, spec] of (cmd.updates as Doc[]).entries()) {
      try {
        const q = toInternal(spec.q) as Doc;
        const u = toInternal(spec.u) as Doc;
        const targets = this.matching(coll, spec.q as Doc);
        const chosen = spec.multi ? targets : targets.slice(0, 1);
        if (chosen.length === 0 && spec.upsert) {
          const doc = updatedCopy(upsertSeed(q), u, true, spec.arrayFilters as Doc[] | undefined);
          if (doc._id === undefined) doc._id = OID + new ObjectId().toHexString();
          checkUnique(db, collName, coll, doc);
          coll.docs.push(doc);
          n++;
          upserted.push({ index, _id: toExternal(doc._id) });
          continue;
        }
        for (const target of chosen) {
          const next = updatedCopy(target, u, false, spec.arrayFilters as Doc[] | undefined);
          checkUnique(db, collName, coll, next, target);
          n++;
          if (JSON.stringify(next) !== JSON.stringify(target)) nModified++;
          coll.docs[coll.docs.indexOf(target)] = next;
        }
      } catch (e) {
        if (!(e instanceof CommandError)) throw e;
        writeErrors.push({ index, code: e.code, errmsg: e.message, ...e.extra });
        if (cmd.ordered !== false) break;
      }
    }
    const res: Doc = { n, nModified, ok: 1 };
    if (upserted.length) res.upserted = upserted;
    if (writeErrors.length) res.writeErrors = writeErrors;
    return res;
  }

  private delete(db: string, cmd: Doc): Doc {
    const coll = this.store.collection(db, String(cmd.delete), false);
    if (!coll) return { n: 0, ok: 1 };
    let n = 0;
    for (const spec of cmd.deletes as Doc[]) {
      const targets = this.matching(coll, spec.q as Doc);
      const chosen = Number(spec.limit) === 1 ? targets.slice(0, 1) : targets;
      for (const t of chosen) {
        coll.docs.splice(coll.docs.indexOf(t), 1);
        n++;
      }
    }
    return { n, ok: 1 };
  }

  private findAndModify(db: string, cmd: Doc): Doc {
    const collName = String(cmd.findAndModify ?? cmd.findandmodify);
    const coll = this.store.collection(db, collName) as Collection;
    const candidates = sortDocs(this.matching(coll, cmd.query as Doc), toInternal(cmd.sort) as Doc | undefined);
    const target = candidates[0];
    const fields = cmd.fields as Doc | undefined;
    const out = (d: Doc | null): unknown => (d ? toExternal(project([clone(d)], fields)[0]) : null);

    if (cmd.remove) {
      if (!target) return { lastErrorObject: { n: 0 }, value: null, ok: 1 };
      coll.docs.splice(coll.docs.indexOf(target), 1);
      return { lastErrorObject: { n: 1 }, value: out(target), ok: 1 };
    }
    const u = toInternal(cmd.update) as Doc;
    if (!target) {
      if (!cmd.upsert) return { lastErrorObject: { n: 0, updatedExisting: false }, value: null, ok: 1 };
      const doc = updatedCopy(upsertSeed(toInternal(cmd.query ?? {}) as Doc), u, true, cmd.arrayFilters as Doc[] | undefined);
      if (doc._id === undefined) doc._id = OID + new ObjectId().toHexString();
      checkUnique(db, collName, coll, doc);
      coll.docs.push(doc);
      return { lastErrorObject: { n: 1, updatedExisting: false, upserted: toExternal(doc._id) }, value: cmd.new ? out(doc) : null, ok: 1 };
    }
    const next = updatedCopy(target, u, false, cmd.arrayFilters as Doc[] | undefined);
    checkUnique(db, collName, coll, next, target);
    coll.docs[coll.docs.indexOf(target)] = next;
    return { lastErrorObject: { n: 1, updatedExisting: true }, value: out(cmd.new ? next : target), ok: 1 };
  }

  private aggregate(db: string, cmd: Doc): Doc {
    const collName = String(cmd.aggregate);
    const coll = this.store.collection(db, collName, false);
    const pipeline = toInternal(cmd.pipeline) as Doc[];
    const resolver = (name: string): Doc[] => (this.store.collection(db, name, false)?.docs ?? []).map(clone);
    const result = new Aggregator(pipeline, { collectionResolver: resolver } as never).run((coll?.docs ?? []).map(clone)) as Doc[];
    return { cursor: { firstBatch: result.map(toExternal), id: 0n, ns: `${db}.${collName}` }, ok: 1 };
  }

  private count(db: string, cmd: Doc): Doc {
    const coll = this.store.collection(db, String(cmd.count), false);
    return { n: coll ? this.matching(coll, cmd.query as Doc).length : 0, ok: 1 };
  }

  private distinct(db: string, cmd: Doc): Doc {
    const coll = this.store.collection(db, String(cmd.distinct), false);
    const values = new Map<string, unknown>();
    for (const d of coll ? this.matching(coll, cmd.query as Doc) : []) {
      const v = getPath(d, String(cmd.key));
      for (const item of Array.isArray(v) ? v : [v]) if (item !== undefined) values.set(JSON.stringify(item), item);
    }
    return { values: [...values.values()].map(toExternal), ok: 1 };
  }

  private createIndexes(db: string, cmd: Doc): Doc {
    const collName = String(cmd.createIndexes);
    const coll = this.store.collection(db, collName) as Collection;
    const before = coll.indexes.length;
    for (const raw of cmd.indexes as Doc[]) {
      const spec: IndexSpec = {
        name: String(raw.name),
        key: raw.key as Record<string, number>,
        unique: Boolean(raw.unique),
        sparse: Boolean(raw.sparse),
        partialFilterExpression: raw.partialFilterExpression ? (toInternal(raw.partialFilterExpression) as Doc) : undefined,
      };
      if (coll.indexes.some((i) => i.name === spec.name)) continue;
      // Building a unique index over existing duplicates fails in mongod too.
      for (const d of coll.docs) checkUnique(db, collName, { docs: coll.docs.filter((x) => x !== d), indexes: [spec] }, d);
      coll.indexes.push(spec);
    }
    return { numIndexesBefore: before, numIndexesAfter: coll.indexes.length, createdCollectionAutomatically: before === 1, ok: 1 };
  }

  private listIndexes(db: string, cmd: Doc): Doc {
    const coll = this.store.collection(db, String(cmd.listIndexes), false);
    if (!coll) throw new CommandError('ns does not exist', 26, 'NamespaceNotFound');
    const batch = coll.indexes.map((i) => ({
      v: 2,
      key: i.key,
      name: i.name,
      ...(i.unique && i.name !== '_id_' ? { unique: true } : {}),
      ...(i.sparse ? { sparse: true } : {}),
      ...(i.partialFilterExpression ? { partialFilterExpression: toExternal(i.partialFilterExpression) } : {}),
    }));
    return { cursor: { firstBatch: batch, id: 0n, ns: `${db}.${String(cmd.listIndexes)}` }, ok: 1 };
  }
}

// ------------------------------------------------------------------ wire framing

function frame(requestId: number, responseTo: number, opCode: number, body: Buffer): Buffer {
  const header = Buffer.alloc(16);
  header.writeInt32LE(16 + body.length, 0);
  header.writeInt32LE(requestId, 4);
  header.writeInt32LE(responseTo, 8);
  header.writeInt32LE(opCode, 12);
  return Buffer.concat([header, body]);
}

function serialize(doc: Doc): Buffer {
  return Buffer.from(BSON.serialize(doc as Document, { ignoreUndefined: true }));
}

function errorDoc(e: unknown): Doc {
  if (e instanceof CommandError) return { ok: 0, errmsg: e.message, code: e.code, codeName: e.codeName, ...e.extra };
  return { ok: 0, errmsg: e instanceof Error ? e.message : String(e), code: 1, codeName: 'InternalError' };
}

function parseOpMsg(buf: Buffer): Doc {
  const flags = buf.readUInt32LE(0);
  const end = flags & 1 ? buf.length - 4 : buf.length;
  let offset = 4;
  let body: Doc = {};
  const sequences: Record<string, Doc[]> = {};
  while (offset < end) {
    const kind = buf.readUInt8(offset);
    offset += 1;
    if (kind === 0) {
      const size = buf.readInt32LE(offset);
      body = BSON.deserialize(buf.subarray(offset, offset + size), { promoteLongs: true }) as Doc;
      offset += size;
    } else {
      const size = buf.readInt32LE(offset);
      const sectionEnd = offset + size;
      let p = offset + 4;
      const nul = buf.indexOf(0, p);
      const id = buf.toString('utf8', p, nul);
      p = nul + 1;
      const docs: Doc[] = [];
      while (p < sectionEnd) {
        const dsize = buf.readInt32LE(p);
        docs.push(BSON.deserialize(buf.subarray(p, p + dsize)) as Doc);
        p += dsize;
      }
      sequences[id] = docs;
      offset = sectionEnd;
    }
  }
  return { ...body, ...sequences };
}

export interface MongoWireDouble {
  uri: string;
  stop(): Promise<void>;
}

export async function startMongoWireDouble(port = 0): Promise<MongoWireDouble> {
  const runner = new CommandRunner(new Store());
  let responseId = 1;
  const sockets = new Set<net.Socket>();

  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    const connectionId = runner.nextConnectionId();
    let pending = Buffer.alloc(0);
    socket.on('data', (chunk) => {
      pending = Buffer.concat([pending, chunk]);
      while (pending.length >= 4) {
        const len = pending.readInt32LE(0);
        if (pending.length < len) break;
        const message = pending.subarray(0, len);
        pending = pending.subarray(len);
        const requestId = message.readInt32LE(4);
        const opCode = message.readInt32LE(12);
        const body = message.subarray(16);
        if (opCode === OP_QUERY) {
          let p = 4;
          p = body.indexOf(0, p) + 1; // collection name
          p += 8; // skip + return counts
          const qsize = body.readInt32LE(p);
          const query = BSON.deserialize(body.subarray(p, p + qsize)) as Doc;
          const cmd = (query.$query as Doc | undefined) ?? query;
          let reply: Doc;
          try {
            reply = runner.run(cmd, connectionId);
          } catch (e) {
            reply = errorDoc(e);
          }
          const doc = serialize(reply);
          const head = Buffer.alloc(20);
          head.writeInt32LE(0, 0);
          head.writeBigInt64LE(0n, 4);
          head.writeInt32LE(0, 12);
          head.writeInt32LE(1, 16);
          socket.write(frame(responseId++, requestId, OP_REPLY, Buffer.concat([head, doc])));
        } else if (opCode === OP_MSG) {
          let reply: Doc;
          try {
            reply = runner.run(parseOpMsg(body), connectionId);
          } catch (e) {
            reply = errorDoc(e);
          }
          const flags = Buffer.alloc(5); // flagBits = 0, section kind 0
          socket.write(frame(responseId++, requestId, OP_MSG, Buffer.concat([flags, serialize(reply)])));
        } else {
          socket.destroy(new Error(`Unsupported opcode ${opCode}`));
        }
      }
    });
    socket.on('error', () => socket.destroy());
  });

  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve));
  const bound = (server.address() as net.AddressInfo).port;
  return {
    uri: `mongodb://127.0.0.1:${bound}/`,
    stop: () =>
      new Promise<void>((resolve) => {
        for (const s of sockets) s.destroy();
        server.close(() => resolve());
      }),
  };
}
