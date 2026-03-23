import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "..", "data");
const FILE = join(DATA_DIR, "warnings.json");

export interface WarnEntry {
  id: string;
  userId: string;
  userTag: string;
  raison: string;
  warnedAt: string;
  warnedBy: string;
  warnedById: string;
}

function ensureDir(): void {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
}

function load(): WarnEntry[] {
  ensureDir();
  if (!existsSync(FILE)) return [];
  try { return JSON.parse(readFileSync(FILE, "utf-8")) as WarnEntry[]; } catch { return []; }
}

function save(list: WarnEntry[]): void {
  ensureDir();
  writeFileSync(FILE, JSON.stringify(list, null, 2), "utf-8");
}

export function getWarnings(userId: string): WarnEntry[] {
  return load().filter(w => w.userId === userId);
}

export function getAllWarnings(): WarnEntry[] {
  return load();
}

export function addWarning(entry: WarnEntry): void {
  const list = load();
  list.push(entry);
  save(list);
}

export function removeWarning(warnId: string): boolean {
  const list = load();
  const i = list.findIndex(w => w.id === warnId);
  if (i === -1) return false;
  list.splice(i, 1);
  save(list);
  return true;
}

export function clearWarnings(userId: string): number {
  const list = load();
  const before = list.length;
  const filtered = list.filter(w => w.userId !== userId);
  save(filtered);
  return before - filtered.length;
}

export function generateWarnId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}
