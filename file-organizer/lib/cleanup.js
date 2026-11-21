import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import { DAY, listFiles } from './scanner.js';

export class Cleanup extends EventEmitter {
  async find(dir, days) {
    const files = await listFiles(dir);
    const old = [];

    for (const file of files) {
      try {
        const { size, mtime } = await fs.stat(file);
        const daysOld = (Date.now() - mtime.getTime()) / DAY;
        if (daysOld > days) {
          old.push({ file, size, mtime, daysOld });
          this.emit('file-found', old.at(-1));
        }
      } catch (error) {
        this.emit('file-error', { file, error });
      }
    }

    return old.sort((a, b) => b.daysOld - a.daysOld);
  }

  async remove(files) {
    let deleted = 0;
    let freed = 0;

    for (const [i, { file, size }] of files.entries()) {
      try {
        await fs.unlink(file);
        deleted++;
        freed += size;
        this.emit('file-deleted', { file, current: i + 1, total: files.length });
      } catch (error) {
        this.emit('file-error', { file, error });
      }
    }

    this.emit('cleanup-complete', { deleted, freed });
  }
}
