#!/usr/bin/env node
/**
 * Clean a composition through RxNorm before it goes into the directory.
 *
 * Why bother
 * ----------
 * An Indian drug list spells the same molecule five ways — AMOXYCILLIN,
 * Amoxycillin Trihydrate, amoxicillin, Amoxicillin Sodium, "Amoxycillin (as
 * trihydrate)". The browser's typo tolerance and the app's duplicate-therapy
 * check both work better when one molecule has one spelling, and no free
 * *Indian* API does that mapping. RxNorm does, it is free, it needs no key, and
 * NLM asks only that you do not hammer it.
 *
 * What it does
 * ------------
 * For each composition it asks RxNorm `approximateTerm` for the closest concept
 * and, if the match is close enough, rewrites the string with the RxNorm name.
 * A salt that RxNorm does not recognise is left exactly as the source wrote it —
 * this is a spelling aid, never a gate. Nothing is ever dropped for not matching.
 *
 *   node scripts/rxnorm-composition.mjs --check "amoxycillin"
 *   node scripts/rxnorm-composition.mjs --file drugs.csv --out drugs.clean.csv
 *
 * Network optional: with no connection the script says so and leaves the file
 * alone. It is a laptop tool, not part of the build.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const BASE = 'https://rxnav.nlm.nih.gov/REST';

/** Below this, the "closest" concept is not the same drug. */
export const MIN_MATCH = 0.8;

const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
/** "clavulanic acid" → "Clavulanic acid" — the way the formulary already prints it. */
const titleCase = (value) => {
  const lower = value.toLowerCase().trim();
  return lower ? lower.charAt(0).toUpperCase() + lower.slice(1) : lower;
};

/**
 * Split "Amoxicillin + Clavulanic acid" into its molecules, dropping the salt
 * forms and the parentheticals that make string comparison fail.
 */
export function splitComposition(composition) {
  return clean(composition)
    .replace(/\([^)]*\)/g, ' ')
    .split('+')
    .map((part) => clean(part))
    .filter(Boolean)
    .map((part) => part
      .replace(/\b(trihydrate|dihydrate|monohydrate|sodium|potassium|calcium|hydrochloride|hcl|maleate|succinate|tartrate|mesylate|besylate|fumarate|citrate|hydrate|anhydrous|as)\b/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim())
    .filter(Boolean);
}

/** RxNorm's answer for one term, or null when it does not know it (or we are offline). */
export async function approximateTerm(term, { timeoutMs = 4000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const url = `${BASE}/approximateTerm.json?term=${encodeURIComponent(term)}&maxEntries=1&option=1`;
    const res = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
    if (!res.ok) return null;
    const body = await res.json();
    const candidate = body?.approximateGroup?.candidate?.[0];
    if (!candidate) return null;
    return { rxcui: candidate.rxcui, score: Number(candidate.score ?? 0), name: candidate.name ?? '' };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** The concept's own properties, for the name RxNorm would print. */
export async function conceptName(rxcui, { timeoutMs = 4000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${BASE}/rxcui/${encodeURIComponent(rxcui)}/properties.json`, { signal: controller.signal });
    if (!res.ok) return null;
    const body = await res.json();
    return body?.properties?.name ?? null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * One composition in, one composition out. On any doubt the input is returned
 * unchanged, so this can be run over a whole file without supervision.
 */
export async function canonicaliseComposition(composition, { lookup = approximateTerm } = {}) {
  const original = clean(composition);
  if (!original) return { composition: original, changed: false, matches: [] };

  const parts = splitComposition(original);
  const matches = [];
  const rebuilt = [];

  for (const part of parts) {
    const hit = await lookup(part);
    if (hit && hit.score >= MIN_MATCH && hit.name) {
      const name = titleCase(hit.name);
      if (name.toLowerCase() !== part.toLowerCase()) matches.push({ from: part, to: name, rxcui: hit.rxcui, score: hit.score });
      rebuilt.push(name);
    } else {
      rebuilt.push(titleCase(part));
    }
  }

  const cleanedUp = rebuilt.join(' + ');
  return { composition: cleanedUp, changed: cleanedUp.toLowerCase() !== original.toLowerCase(), matches };
}

/** Run over a list of compositions, sequentially — NLM asks for no bursts. */
export async function canonicaliseList(list, { lookup = approximateTerm, pauseMs = 120 } = {}) {
  const out = [];
  for (const item of list) {
    const result = await canonicaliseComposition(item, { lookup });
    out.push(result);
    if (pauseMs) await new Promise((resolve) => setTimeout(resolve, pauseMs));
  }
  return out;
}

async function main(argv) {
  const arg = (flag) => {
    const i = argv.indexOf(flag);
    return i === -1 ? null : argv[i + 1];
  };

  const check = arg('--check');
  if (check) {
    const result = await canonicaliseComposition(check);
    if (!result.matches.length) {
      console.log(`"${check}" is already how RxNorm spells it (or RxNorm does not know it)`);
    } else {
      for (const m of result.matches) console.log(`${m.from} → ${m.to}  (rxcui ${m.rxcui}, score ${m.score.toFixed(2)})`);
    }
    console.log(`composition: ${result.composition}`);
    return;
  }

  const file = arg('--file');
  const out = arg('--out');
  if (!file) {
    console.error('usage: node scripts/rxnorm-composition.mjs --check "amoxycillin" | --file in.csv --out out.csv');
    process.exit(2);
  }

  const text = await readFile(file, 'utf8');
  const lines = text.split('\n');
  const header = lines[0].split(',');
  const column = header.findIndex((h) => /composition|generic|salt|molecule/i.test(h));
  if (column === -1) {
    console.error('no composition column found in the header row');
    process.exit(2);
  }

  const probe = await approximateTerm('paracetamol');
  if (!probe) {
    console.error('RxNorm could not be reached (or answered nothing) — file left untouched. Working offline is fine; re-run when connected.');
    process.exit(1);
  }

  const results = [];
  for (const line of lines.slice(1)) {
    const cells = line.split(',');
    if (cells.length <= column || !cells[column]?.trim()) { results.push(null); continue; }
    results.push(await canonicaliseComposition(cells[column]));
  }

  let changed = 0;
  const rebuilt = [lines[0], ...lines.slice(1).map((line, i) => {
    const result = results[i];
    if (!result || !result.changed) return line;
    changed += 1;
    const cells = line.split(',');
    cells[column] = result.composition;
    return cells.join(',');
  })];

  const cleaned = rebuilt.join('\n');
  await writeFile(out ?? file.replace(/(\.\w+)$/, '.clean$1'), cleaned, 'utf8');
  console.log(`${changed} of ${results.filter(Boolean).length} compositions were re-spelled to the RxNorm name`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
