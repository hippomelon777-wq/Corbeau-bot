import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "..", "data");
const FILE = join(DATA_DIR, "owners.json");

export interface OwnerEntry {
  id: string;
  tag: string;
  addedAt: string;
  addedBy: string;
}

function ensureDir(): void {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
}

function load(): OwnerEntry[] {
  ensureDir();
  if (!existsSync(FILE)) return [];
  try { return JSON.parse(readFileSync(FILE, "utf-8")) as OwnerEntry[]; } catch { return []; }
}

function save(list: OwnerEntry[]): void {
  ensureDir();
  writeFileSync(FILE, JSON.stringify(list, null, 2), "utf-8");
}

export function getOwners(): OwnerEntry[] { return load(); }
export function isOwner(userId: string): boolean { return load().some(e => e.id === userId); }

export function addOwner(entry: OwnerEntry): void {
  const list = load();
  if (!list.some(e => e.id === entry.id)) { list.push(entry); save(list); }
}

export function removeOwner(userId: string): boolean {
  const list = load();
  const i = list.findIndex(e => e.id === userId);
  if (i === -1) return false;
  list.splice(i, 1);
  save(list);
  return true;
}
