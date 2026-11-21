import { EventEmitter } from 'node:events';
import { createReadStream, createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { listFiles } from './scanner.js';

const LARGE_FILE = 10 * 1024 * 1024;

const categories = {
  Documents: ['.pdf', '.docx', '.doc', '.txt', '.md', '.xlsx', '.pptx'],
  Images: ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.bmp'],
  Archives: ['.zip', '.rar', '.tar', '.gz', '.7z'],
  Code: ['.js', '.py', '.java', '.cpp', '.html', '.css', '.json'],
  Videos: ['.mp4', '.avi', '.mkv', '.mov', '.webm'],
  Other: [],
};

function getCategory(file) {
  const ext = path.extname(file).toLowerCase();
  return Object.keys(categories).find((c) => categories[c].includes(ext)) ?? 'Other';
}

async function uniquePath(dir, fileName) {
  const { name, ext } = path.parse(fileName);

  for (let i = 0; ; i++) {
    const candidate = path.join(dir, i ? `${name}(${i})${ext}` : fileName);

    try {
      await fs.access(candidate);
    } catch {
      return candidate;
    }
  }
}

export class Organizer extends EventEmitter {
  async organize(source, target) {
    const files = await listFiles(source);
    this.emit('organize-start', { source, target });

    for (const category of Object.keys(categories)) {
      await fs.mkdir(path.join(target, category), { recursive: true });
      this.emit('folder-created', { category });
    }

    const summary = Object.fromEntries(Object.keys(categories).map((c) => [c, 0]));
    let copied = 0;
    let totalSize = 0;

    for (const [i, file] of files.entries()) {
      const category = getCategory(file);
      this.emit('copy-start', { file, category });

      try {
        const { size } = await fs.stat(file);
        const targetPath = await uniquePath(path.join(target, category), path.basename(file));

        if (size >= LARGE_FILE) {
          await pipeline(createReadStream(file), createWriteStream(targetPath));
        } else {
          await fs.copyFile(file, targetPath);
        }

        summary[category]++;
        copied++;
        totalSize += size;
        this.emit('copy-complete', { file, targetPath, current: i + 1, total: files.length });
      } catch (error) {
        this.emit('copy-error', { file, error });
      }
    }

    this.emit('organize-complete', { target, summary, copied, totalSize });
  }
}
