import { mkdir, readdir, stat } from 'node:fs/promises';
import path from 'node:path';

export const LIBRARY_KINDS = Object.freeze({
  map: { folder: 'maps', media: 'image' },
  token: { folder: 'tokens', media: 'image' },
  object: { folder: 'objects', media: 'image' },
  audio: { folder: 'music', media: 'audio' },
  sound: { folder: 'sounds', media: 'audio' },
});

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);
const AUDIO_EXTENSIONS = new Set(['.mp3', '.ogg', '.wav', '.mp4', '.m4a', '.webm', '.aac']);

export async function createLibraryDirectories(libraryDirectory) {
  await Promise.all(Object.values(LIBRARY_KINDS).map(({ folder }) => mkdir(path.join(libraryDirectory, folder), { recursive: true })));
}

export function validLibraryFileName(kind, fileName) {
  const config = LIBRARY_KINDS[kind];
  if (!config || typeof fileName !== 'string' || !fileName || fileName.length > 255) return false;
  if (fileName === '.' || fileName === '..' || fileName.includes('..')) return false;
  if (fileName.includes('/') || fileName.includes('\\') || fileName.includes('\0') || path.basename(fileName) !== fileName) return false;
  const extension = path.extname(fileName).toLowerCase();
  return (config.media === 'image' ? IMAGE_EXTENSIONS : AUDIO_EXTENSIONS).has(extension);
}

function itemName(fileName) {
  return path.basename(fileName, path.extname(fileName)).trim() || fileName;
}

export async function listLibrary(libraryDirectory) {
  const groups = await Promise.all(Object.entries(LIBRARY_KINDS).map(async ([kind, config]) => {
    const directory = path.join(libraryDirectory, config.folder);
    const entries = await readdir(directory, { withFileTypes: true });
    const files = await Promise.all(entries.filter((entry) => entry.isFile() && validLibraryFileName(kind, entry.name)).map(async (entry) => {
      const stats = await stat(path.join(directory, entry.name));
      return {
        kind,
        fileName: entry.name,
        name: itemName(entry.name),
        url: `/library/${config.folder}/${encodeURIComponent(entry.name)}`,
        size: stats.size,
        modifiedAt: stats.mtimeMs,
      };
    }));
    return files;
  }));
  return groups.flat().sort((a, b) => a.kind.localeCompare(b.kind) || a.fileName.localeCompare(b.fileName));
}

export async function resolveLibraryFile(libraryDirectory, kind, fileName) {
  if (!validLibraryFileName(kind, fileName)) throw new Error('Invalid library file name');
  const config = LIBRARY_KINDS[kind];
  const filePath = path.join(libraryDirectory, config.folder, fileName);
  const stats = await stat(filePath);
  if (!stats.isFile()) throw new Error('Library entry is not a file');
  return {
    filePath,
    url: `/library/${config.folder}/${encodeURIComponent(fileName)}`,
    fallbackName: itemName(fileName),
  };
}
