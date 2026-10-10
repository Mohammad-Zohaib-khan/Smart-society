import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomToken } from '../lib/crypto.js';

/** Stores uploads under random keys; original file names are never used as paths. */
export interface FileStorage {
  put(data: Buffer, extension: string): Promise<string>;
  get(key: string): Promise<Buffer>;
  remove(key: string): Promise<void>;
}

const KEY = /^[A-Za-z0-9_-]{20,64}\.(jpg|png|webp|pdf)$/;

export class LocalDiskStorage implements FileStorage {
  constructor(private readonly root: string) {}

  private resolve(key: string): string {
    if (!KEY.test(key)) throw new Error('Invalid storage key');
    return path.join(path.resolve(this.root), key);
  }

  async put(data: Buffer, extension: string): Promise<string> {
    await mkdir(path.resolve(this.root), { recursive: true });
    const key = `${randomToken(24)}.${extension}`;
    await writeFile(this.resolve(key), data, { flag: 'wx' });
    return key;
  }

  get(key: string): Promise<Buffer> {
    return readFile(this.resolve(key));
  }

  async remove(key: string): Promise<void> {
    await rm(this.resolve(key), { force: true });
  }
}
