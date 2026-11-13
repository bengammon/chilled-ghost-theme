// Writes <package name>.zip for a manual theme upload in Ghost admin, using
// only Node's built-in zlib (no archiver/bestzip dependency tree).
// Includes the same files the deploy workflow uploads. Run `npm run build`
// first; `npm run zip` does both.

import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, sep } from 'node:path';
import { crc32, deflateRawSync } from 'node:zlib';

const root = process.cwd();
const { name } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const outName = `${name}.zip`;

// Keep in step with the upload-artifact paths in .github/workflows/deploy-theme.yml.
const DIRS = ['assets', 'partials', 'members'];
const ROOT_FILES = ['package.json', 'LICENSE'];

// Returns paths relative to the repo root.
function walk(dir) {
    return readdirSync(join(root, dir), { withFileTypes: true }).flatMap((entry) => {
        const path = join(dir, entry.name);
        return entry.isDirectory() ? walk(path) : entry.isFile() ? [path] : [];
    });
}

const files = [
    ...readdirSync(root).filter((f) => f.endsWith('.hbs')),
    ...ROOT_FILES,
    ...DIRS.flatMap((d) => walk(d)),
]
    .map((f) => f.split(sep).join('/'))
    .filter((f, i, all) => all.indexOf(f) === i)
    .sort();

if (!files.includes('assets/built/index.js')) {
    console.error('assets/built/index.js is missing: run `npm run build` first.');
    process.exit(1);
}

// MS-DOS date and time, as zip headers store them.
function dosDateTime(date) {
    const time = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
    const day = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
    return { time, day };
}

const locals = [];
const centrals = [];
let offset = 0;

for (const file of files) {
    const data = readFileSync(join(root, file));
    const deflated = deflateRawSync(data, { level: 9 });
    // Store small or incompressible files (images, woff2) as they are.
    const store = deflated.length >= data.length;
    const body = store ? data : deflated;
    const nameBuf = Buffer.from(file, 'utf8');
    const crc = crc32(data);
    const { time, day } = dosDateTime(statSync(join(root, file)).mtime);
    const method = store ? 0 : 8;
    const flags = 0x0800; // file names are UTF-8

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed: 2.0
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(day, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, nameBuf, body);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(day, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    // extra length, comment length, disk number, internal and external attributes: all 0
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);

    offset += local.length + nameBuf.length + body.length;
}

const centralSize = centrals.reduce((n, b) => n + b.length, 0);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(files.length, 8);
end.writeUInt16LE(files.length, 10);
end.writeUInt32LE(centralSize, 12);
end.writeUInt32LE(offset, 16);

const zip = Buffer.concat([...locals, ...centrals, end]);
writeFileSync(join(root, outName), zip);
console.log(`Wrote ${outName}: ${files.length} files, ${(zip.length / 1024).toFixed(0)} KB`);
