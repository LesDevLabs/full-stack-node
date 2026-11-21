import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import path from 'node:path';

export const DAY = 24 * 60 * 60 * 1000;

export async function listFiles(dir) {
  const entries = await fs.readdir(dir, { recursive: true, withFileTypes: true });
  return entries.filter((e) => e.isFile()).map((e) => path.join(e.parentPath, e.name));
}

export class Scanner extends EventEmitter {
  async scan(dir) {
    const files = await listFiles(dir);
    this.emit('scan-start', { dir });

    const stats = { count: 0, size: 0, byType: new Map(), last7: 0, last30: 0, older90: 0 };
    const found = [];

    for (const [i, file] of files.entries()) {
      try {
        const { size, mtime } = await fs.stat(file);
        const days = (Date.now() - mtime.getTime()) / DAY;
        const ext = path.extname(file).toLowerCase() || '(no ext)';
        const type = stats.byType.get(ext) ?? { count: 0, size: 0 };

        stats.byType.set(ext, { count: type.count + 1, size: type.size + size });
        stats.count++;
        stats.size += size;

        if (days <= 7) stats.last7++;
        if (days <= 30) stats.last30++;
        if (days > 90) stats.older90++;

        found.push({ file, size, days });
        this.emit('file-found', { file, size, current: i + 1, total: files.length });
      } catch (error) {
        this.emit('file-error', { file, error });
      }
    }

    stats.largest = found.toSorted((a, b) => b.size - a.size).slice(0, 3);
    stats.oldest = found.toSorted((a, b) => b.days - a.days)[0];

    this.emit('scan-complete', stats);
  }
}
