import { EventEmitter } from 'node:events';
import crypto from 'node:crypto';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import { listFiles } from './scanner.js';

function calculateHash(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = createReadStream(filePath);

    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

export class DuplicateFinder extends EventEmitter {
  async find(dir) {
    const files = await listFiles(dir);
    this.emit('search-start', { dir });

    const byHash = new Map();

    for (const [i, file] of files.entries()) {
      try {
        const { size } = await fs.stat(file);
        const hash = await calculateHash(file);
        const group = byHash.get(hash) ?? { hash, size, paths: [] };

        group.paths.push(file);
        byHash.set(hash, group);

        this.emit('file-processed', { file, current: i + 1, total: files.length });
      } catch (error) {
        this.emit('file-error', { file, error });
      }
    }

    const groups = [...byHash.values()].filter((g) => g.paths.length > 1);
    const totalWasted = groups.reduce((sum, g) => sum + g.size * (g.paths.length - 1), 0);

    this.emit('duplicates-found', { groups, totalWasted });
  }
}
