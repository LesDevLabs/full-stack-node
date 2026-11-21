import path from 'node:path';
import { Scanner } from './lib/scanner.js';
import { DuplicateFinder } from './lib/duplicates.js';
import { Organizer } from './lib/organizer.js';
import { Cleanup } from './lib/cleanup.js';

const LINE = '━'.repeat(34);
const ERRORS = {
  ENOENT: 'Not found',
  EACCES: 'Permission denied',
  EPERM: 'Operation not permitted',
  ENOTDIR: 'Not a directory',
  EBUSY: 'File is busy or locked',
};

function formatSize(bytes) {
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

function drawProgressBar(current, total, width = 20) {
  const filled = Math.round((current / total) * width);
  return `${'█'.repeat(filled)}${'░'.repeat(width - filled)} ${current}/${total}`;
}

const progress = (label, suffix = '') => ({ current, total }) =>
  process.stdout.write(`\r${label} ${drawProgressBar(current, total)}${suffix}`);

function errorMessage(error, target) {
  return ERRORS[error.code] ? `${ERRORS[error.code]}: ${target}` : `Unexpected error: ${error.message}`;
}

const warn = ({ file, error }) => console.error(`\n⚠️  ${errorMessage(error, file)}`);

function fail(message) {
  console.error(`❌ ${message}`);
  process.exit(1);
}

const [command, dirArg, ...flags] = process.argv.slice(2);

function flag(name) {
  const i = flags.indexOf(name);
  return i === -1 ? undefined : flags[i + 1];
}

async function scan(dir) {
  const scanner = new Scanner();

  scanner.on('scan-start', ({ dir }) => console.log(`📂 Scanning: ${dir}`));
  scanner.on('file-found', progress('Processing...', ' files'));
  scanner.on('file-error', warn);
  scanner.on('scan-complete', (s) => {
    console.log(`\n\n📊 Scan Results:\n${LINE}`);
    console.log(`Total files: ${s.count}\nTotal size: ${formatSize(s.size)}\n\nBy File Type:`);
    for (const [ext, { count, size }] of [...s.byType].sort((a, b) => b[1].size - a[1].size)) {
      console.log(`  ${ext.padEnd(8)}${String(count).padStart(4)} files ${formatSize(size).padStart(10)}`);
    }
    console.log(`\nFile Age:\n  Last 7 days:    ${s.last7} files\n  Last 30 days:   ${s.last30} files`);
    console.log(`  Older than 90:  ${s.older90} files\n\nLargest files:`);
    s.largest.forEach(({ file, size }, i) => {
      console.log(`  ${i + 1}. ${path.basename(file).padEnd(20)} ${formatSize(size)}`);
    });
    if (s.oldest) {
      console.log(`\nOldest file: ${path.basename(s.oldest.file)} (modified ${Math.floor(s.oldest.days)} days ago)`);
    }
  });

  await scanner.scan(dir);
}

async function duplicates(dir) {
  const finder = new DuplicateFinder();

  finder.on('search-start', ({ dir }) => console.log(`🔍 Searching for duplicates in: ${dir}`));
  finder.on('file-processed', progress('Calculating hashes...', ' files'));
  finder.on('file-error', warn);
  finder.on('duplicates-found', ({ groups, totalWasted }) => {
    console.log(`\n\nFound ${groups.length} duplicate groups (${formatSize(totalWasted)} wasted):\n`);
    groups.forEach(({ hash, size, paths }, i) => {
      const wasted = size * (paths.length - 1);
      console.log(`${LINE}\nGroup ${i + 1} (${paths.length} copies, ${formatSize(size)} each):`);
      console.log(`  SHA-256: ${hash.slice(0, 12)}...\n`);
      paths.forEach((p) => console.log(`  📄 ${path.relative(path.dirname(dir), p)}`));
      console.log(`\n  Wasted space: ${formatSize(wasted)}\n`);
    });
    console.log(`${LINE}\n💾 Total wasted space: ${formatSize(totalWasted)}`);
  });

  await finder.find(dir);
}

async function organize(dir) {
  const output = flag('--output');
  if (!output) fail('Missing --output <directory>');

  const organizer = new Organizer();

  organizer.on('organize-start', ({ source, target }) => {
    console.log(`📦 Organizing: ${source}\nTarget: ${target}\n\nCreating folders...`);
  });
  organizer.on('folder-created', ({ category }) => console.log(`  ✓ ${category}/`));
  organizer.once('copy-start', () => console.log());
  organizer.on('copy-complete', progress('Copying files...'));
  organizer.on('copy-error', warn);
  organizer.on('organize-complete', ({ target, summary, copied, totalSize }) => {
    console.log('\n\n✅ Organization complete!\n\nSummary:');
    for (const [category, count] of Object.entries(summary)) {
      console.log(`  ${`${category}:`.padEnd(11)}${String(count).padStart(4)} files → ${path.basename(target)}/${category}/`);
    }
    console.log(`\nTotal copied: ${copied} files (${formatSize(totalSize)})`);
  });

  await organizer.organize(dir, path.resolve(output));
}

async function cleanup(dir) {
  const days = Number(flag('--older-than'));

  if (!(days >= 0)) fail('--older-than <days> must be a non-negative number');

  const cleaner = new Cleanup();
  cleaner.on('file-error', warn);
  cleaner.on('file-deleted', progress('Deleting...'));
  cleaner.on('cleanup-complete', ({ deleted, freed }) => {
    console.log(`\n\n✅ Cleanup complete!\nDeleted: ${deleted} files (${formatSize(freed)} freed)`);
  });

  console.log(`🧹 Cleanup: ${dir}\nLooking for files older than ${days} days...\n`);
  const files = await cleaner.find(dir, days);
  const total = formatSize(files.reduce((sum, f) => sum + f.size, 0));

  console.log(`Found ${files.length} files to delete:\n\n${LINE}`);
  for (const { file, size, mtime, daysOld } of files.slice(0, 3)) {
    console.log(path.relative(dir, file));
    console.log(`  Size: ${formatSize(size)}\n  Modified: ${Math.floor(daysOld)} days ago (${mtime.toISOString().slice(0, 10)})\n`);
  }
  if (files.length > 3) console.log(`... (${files.length - 3} more files)`);
  console.log(`${LINE}\n\nTotal: ${files.length} files (${total})\n`);

  if (!flags.includes('--confirm')) {
    console.log('⚠️  DRY RUN MODE: No files were deleted.\nTo actually delete these files, run with --confirm flag.');
    return;
  }
  console.log(`⚠️  DELETING ${files.length} files (${total}). This action cannot be undone!\n`);
  await cleaner.remove(files);
}

const commands = { scan, duplicates, organize, cleanup };

if (!commands[command] || !dirArg) {
  fail('Usage: node file-organizer.js <scan|duplicates|organize|cleanup> <directory> [--output <dir>] [--older-than <days>] [--confirm]');
}

try {
  await commands[command](path.resolve(dirArg));
} catch (error) {
  fail(errorMessage(error, error.path));
}
