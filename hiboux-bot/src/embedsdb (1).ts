import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "..", "data");
const EMBEDS_FILE = join(DATA_DIR, "embeds.json");
const TICKETS_FILE = join(DATA_DIR, "tickets.json");

function ensureDir(): void {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
}

// ══════════════════════════════════════════════════════════════════════════════
// EMBEDS
// ══════════════════════════════════════════════════════════════════════════════
export interface EmbedPage {
  titre: string;
  texte: string;
  image?: string;
}

export interface SavedEmbed {
  titre: string;           // identifiant unique
  pages: EmbedPage[];      // une ou plusieurs pages
  afficherDate: boolean;
  signature?: string;      // ex: "Posté par Staff"
  couleur: string;         // ex: "#5865f2"
  createdAt: string;
  createdBy: string;
}

function loadEmbeds(): SavedEmbed[] {
  ensureDir();
  if (!existsSync(EMBEDS_FILE)) return [];
  try { return JSON.parse(readFileSync(EMBEDS_FILE, "utf-8")) as SavedEmbed[]; } catch { return []; }
}

function saveEmbeds(list: SavedEmbed[]): void {
  ensureDir();
  writeFileSync(EMBEDS_FILE, JSON.stringify(list, null, 2), "utf-8");
}

export function getAllEmbeds(): SavedEmbed[] { return loadEmbeds(); }

export function getEmbed(titre: string): SavedEmbed | null {
  return loadEmbeds().find(e => e.titre.toLowerCase() === titre.toLowerCase()) ?? null;
}

export function createEmbed(embed: SavedEmbed): void {
  const list = loadEmbeds();
  list.push(embed);
  saveEmbeds(list);
}

export function updateEmbed(titre: string, patch: Partial<SavedEmbed>): boolean {
  const list = loadEmbeds();
  const idx = list.findIndex(e => e.titre.toLowerCase() === titre.toLowerCase());
  if (idx === -1) return false;
  list[idx] = { ...list[idx]!, ...patch };
  saveEmbeds(list);
  return true;
}

export function deleteEmbed(titre: string): boolean {
  const list = loadEmbeds();
  const idx = list.findIndex(e => e.titre.toLowerCase() === titre.toLowerCase());
  if (idx === -1) return false;
  list.splice(idx, 1);
  saveEmbeds(list);
  return true;
}

// ══════════════════════════════════════════════════════════════════════════════
// TICKETS
// ══════════════════════════════════════════════════════════════════════════════
export interface SavedTicket {
  titre: string;
  description: string;
  bouton: string;
  couleur: string;
  rolesAcces: string[];
  createdAt: string;
  createdBy: string;
}

function loadTickets(): SavedTicket[] {
  ensureDir();
  if (!existsSync(TICKETS_FILE)) return [];
  try { return JSON.parse(readFileSync(TICKETS_FILE, "utf-8")) as SavedTicket[]; } catch { return []; }
}

function saveTickets(list: SavedTicket[]): void {
  ensureDir();
  writeFileSync(TICKETS_FILE, JSON.stringify(list, null, 2), "utf-8");
}

export function getAllTickets(): SavedTicket[] { return loadTickets(); }

export function getTicket(titre: string): SavedTicket | null {
  return loadTickets().find(t => t.titre.toLowerCase() === titre.toLowerCase()) ?? null;
}

export function createTicket(ticket: SavedTicket): void {
  const list = loadTickets();
  list.push(ticket);
  saveTickets(list);
}

export function updateTicket(titre: string, patch: Partial<SavedTicket>): boolean {
  const list = loadTickets();
  const idx = list.findIndex(t => t.titre.toLowerCase() === titre.toLowerCase());
  if (idx === -1) return false;
  list[idx] = { ...list[idx]!, ...patch };
  saveTickets(list);
  return true;
}

export function deleteTicket(titre: string): boolean {
  const list = loadTickets();
  const idx = list.findIndex(t => t.titre.toLowerCase() === titre.toLowerCase());
  if (idx === -1) return false;
  list.splice(idx, 1);
  saveTickets(list);
  return true;
}
