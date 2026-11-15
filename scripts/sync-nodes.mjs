// Ajoute dans .upptimerc.yml les noeuds VPN presents dans l'API et absents de la config.
// Ne retire jamais rien : l'API masque aussi les noeuds en panne ou satures.
// Usage : node scripts/sync-nodes.mjs [chemin/.upptimerc.yml]
// Sans dependance (Node 20+).

import { readFile, writeFile } from "node:fs/promises";

const API = "https://api.fuzevpn.com/v1/locations";
const CONFIG = process.argv[2] ?? ".upptimerc.yml";
const START = "  # nodes:start";
const END = "  # nodes:end";
// Seules ces URL peuvent entrer dans la config : la reponse de l'API n'est pas ecrite telle quelle.
const URL_OK = /^https:\/\/[a-z0-9-]+\.fuzevpn\.com\/ping$/;

function nodeName({ id, city, country_code }) {
  const num = /-(\d+)$/.exec(id)?.[1] ?? "";
  const label = [city, num].filter(Boolean).join(" ");
  return `VPN - ${label} (${country_code})`.replace(/[^\p{L}\p{N} ()\-.]/gu, "");
}

const res = await fetch(API, { signal: AbortSignal.timeout(20_000) });
if (!res.ok) throw new Error(`API ${res.status} : config laissee intacte`);
const { locations } = await res.json();
if (!Array.isArray(locations) || locations.length === 0) {
  throw new Error("Liste de noeuds vide : config laissee intacte");
}

const text = (await readFile(CONFIG, "utf8")).replace(/\r\n/g, "\n");
const a = text.indexOf(START);
const b = text.indexOf(END);
if (a === -1 || b === -1 || b < a) throw new Error("Marqueurs nodes:start / nodes:end introuvables");

const block = text.slice(a + START.length, b);
const known = new Set([...block.matchAll(/url:\s*(\S+)/g)].map((m) => m[1]));
const live = new Set();
let added = "";

for (const loc of locations) {
  const url = loc.latency_url;
  if (typeof url !== "string" || !URL_OK.test(url)) {
    console.log(`Ignore (URL inattendue) : ${loc.id}`);
    continue;
  }
  live.add(url);
  if (known.has(url)) continue;
  added += `  - name: ${JSON.stringify(nodeName(loc))}\n    url: ${url}\n    expectedStatusCodes:\n      - 204\n`;
  console.log(`Ajoute : ${loc.id}`);
}

for (const url of known) {
  if (!live.has(url)) console.log(`Absent de l'API (en panne, sature ou supprime), conserve : ${url}`);
}

if (added) {
  const body = block.replace(/^\n/, "").replace(/\s+$/, "");
  const merged = [body, added.trimEnd()].filter(Boolean).join("\n");
  await writeFile(CONFIG, `${text.slice(0, a)}${START}\n${merged}\n${text.slice(b)}`);
} else {
  console.log("Aucun nouveau noeud.");
}
