import { readFileSync, writeFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FILE = join(__dirname, "..", "blacklist.json");

export interface BlacklistEntry {
  id: string;
  tag: string;
  raison: string;
  addedAt: string;
  addedBy: string;
}

function load(): BlacklistEntry[] {
  if (!existsSync(FILE)) return [];
  try {
    return JSON.parse(readFileSync(FILE, "utf-8")) as BlacklistEntry[];
  } catch {
    return [];
  }
}

function save(list: BlacklistEntry[]): void {
  writeFileSync(FILE, JSON.stringify(list, null, 2), "utf-8");
}

export function getBlacklist(): BlacklistEntry[] {
  return load();
}

export function isBlacklisted(userId: string): boolean {
  return load().some((e) => e.id === userId);
}

export function addToBlacklist(entry: BlacklistEntry): void {
  const list = load();
  if (!list.some((e) => e.id === entry.id)) {
    list.push(entry);
    save(list);
  }
}

export function removeFromBlacklist(userId: string): boolean {
  const list = load();
  const index = list.findIndex((e) => e.id === userId);
  if (index === -1) return false;
  list.splice(index, 1);
  save(list);
  return true;
}
