import fs from 'fs/promises';
import path from 'path';

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function sanitizeFilename(name) {
  return name.replace(/[^a-z0-9-_]+/gi, '_').replace(/_+/g, '_').slice(0, 80);
}

export async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

export async function writeJson(filePath, data) {
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
}

export function toCsv(rows) {
  if (rows.length === 0) return '';

  const headers = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  const escape = (value) => {
    if (value === null || value === undefined) return '';
    const str = String(value).replace(/\r\n/g, '\n');
    if (/[",\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
    return str;
  };

  const lines = [
    headers.join(','),
    ...rows.map((row) => headers.map((header) => escape(row[header])).join(',')),
  ];

  return lines.join('\n');
}

export async function writeCsv(filePath, rows) {
  await fs.writeFile(filePath, toCsv(rows), 'utf8');
}

export function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

export function outputDir(base = 'output') {
  return path.join(process.cwd(), base, timestamp());
}
