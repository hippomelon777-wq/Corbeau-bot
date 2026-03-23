import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "..", "data");
const FILE = join(DATA_DIR, "whitelist.json");

export interface WhitelistEntry {
  id: string;
  tag: string;
  addedAt: string;
  addedBy: string;
}

function ensureDir(): void {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
}

function load(): WhitelistEntry[] {
  ensureDir();
  if (!existsSync(FILE)) return [];
  try { return JSON.parse(readFileSync(FILE, "utf-8")) as WhitelistEntry[]; } catch { return []; }
}

function save(list: WhitelistEntry[]): void {
  ensureDir();
  writeFileSync(FILE, JSON.stringify(list, null, 2), "utf-8");
}

export function getWhitelist(): WhitelistEntry[] { return load(); }
export function isWhitelisted(userId: string): boolean { return load().some(e => e.id === userId); }

export function addToWhitelist(entry: WhitelistEntry): void {
  const list = load();
  if (!list.some(e => e.id === entry.id)) { list.push(entry); save(list); }
}

export function removeFromWhitelist(userId: string): boolean {
  const list = load();
  const i = list.findIndex(e => e.id === userId);
  if (i === -1) return false;
  list.splice(i, 1);
  save(list);
  return true;
}
