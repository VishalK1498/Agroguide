// Downloads today's mandi prices from data.gov.in (Agmarknet) and saves them as a small JSON file
// for the website. Run by GitHub Actions every day, or by hand:
//   Windows PowerShell:  $env:DATA_GOV_API_KEY="your-key"; node scripts/fetch-prices.mjs data/prices.json
//   Mac / Linux:         DATA_GOV_API_KEY=your-key node scripts/fetch-prices.mjs data/prices.json
// It never stops the website from deploying: if the government API is down it falls back to the last
// published file (or a committed copy), and finally to an empty file that makes the page say "not available yet".
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const OUT = process.argv[2] || 'data/prices.json';
const KEY = process.env.DATA_GOV_API_KEY || '';
const STATES = (process.env.PRICE_STATES || 'Maharashtra,Karnataka,Gujarat,Madhya Pradesh,Telangana,Andhra Pradesh,Rajasthan,Uttar Pradesh,Chhattisgarh,Punjab,Haryana,Tamil Nadu,West Bengal')
  .split(',').map(s => s.trim()).filter(Boolean);
const API_BASE = process.env.PRICE_API_BASE || 'https://api.data.gov.in/resource/9ef84268-d588-465a-a308-a864a43d0070';
const LIVE_URL = process.env.PAGES_DATA_URL || '';     // the currently published copy, used if the API fails today
const LOCAL_COPY = process.env.PRICE_LOCAL_COPY || 'data/prices.json';
const LIMIT = 1000, MAX_PAGES = 12;   // per state
const FIELDS = ['state', 'district', 'market', 'commodity', 'variety', 'grade', 'date', 'min', 'max', 'modal'];

const sleep = ms => new Promise(r => setTimeout(r, ms));
const isoDate = s => {                                  // "08/10/2026" -> "2026-10-08"
  const m = String(s || '').match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
  return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : String(s || '');
};

async function getJson(url, tries = 3){
  for (let i = 1; i <= tries; i++){
    try{
      const ctrl = new AbortController(), timer = setTimeout(() => ctrl.abort(), 45000);
      const res = await fetch(url, {signal: ctrl.signal, headers: {accept: 'application/json', 'user-agent': 'agroguide-price-updater'}});
      clearTimeout(timer);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.json();
    }catch(e){
      const why = e.cause ? ' (' + (e.cause.code || e.cause.message) + ')' : '';
      console.log(`  attempt ${i}/${tries} failed: ${e.message}${why}`);
      if (i < tries) await sleep(3000 * i);
    }
  }
  return null;
}

async function fromApi(){
  if (!KEY){ console.log('::warning::DATA_GOV_API_KEY is not set - skipping the live download.'); return null; }
  const rows = []; let latest = '';
  for (const state of STATES){
    let offset = 0, got = 0;
    for (let page = 0; page < MAX_PAGES; page++){
      const url = `${API_BASE}?api-key=${encodeURIComponent(KEY)}&format=json&limit=${LIMIT}&offset=${offset}&filters%5Bstate%5D=${encodeURIComponent(state)}`;
      console.log(`${state}: downloading page ${page + 1} (offset ${offset}) ...`);
      const json = await getJson(url);
      if (!json || !Array.isArray(json.records)) break;
      for (const r of json.records){
        const modal = Number(r.modal_price), min = Number(r.min_price), max = Number(r.max_price);
        if (!Number.isFinite(modal) || modal <= 0) continue;
        const date = isoDate(r.arrival_date);
        rows.push([r.state || state, r.district || '', r.market || '', r.commodity || '', r.variety || '', r.grade || '', date,
                   Number.isFinite(min) && min > 0 ? min : modal, Number.isFinite(max) && max > 0 ? max : modal, modal]);
        if (date > latest) latest = date;
        got++;
      }
      if (json.records.length < LIMIT) break;
      offset += LIMIT;
      await sleep(400);
    }
    console.log(`${state}: ${got} price rows`);
    if (!rows.length && state === STATES[0]){ console.log('::warning::The first state could not be downloaded, so the others are skipped.'); break; }
    await sleep(400);
  }
  if (!rows.length) return null;
  return {source: 'Agmarknet via data.gov.in (Open Government Data Platform India)', states: STATES, updated: latest,
          fetchedAt: new Date().toISOString(), unit: 'INR per quintal', fields: FIELDS, rows};
}
const usable = j => j && Array.isArray(j.rows) && j.rows.length ? j : null;

let data = await fromApi();
if (data) console.log(`Live download OK: ${data.rows.length} price rows, latest date ${data.updated}.`);
if (!data && LIVE_URL){
  console.log('::warning::Live download failed - trying the last published copy.');
  data = usable(await getJson(LIVE_URL, 2));
  if (data) console.log(`Reusing the published copy (${data.rows.length} rows, dated ${data.updated}).`);
}
if (!data){
  try{ data = usable(JSON.parse(await readFile(LOCAL_COPY, 'utf8'))); if (data) console.log('::warning::Using the copy stored in the repository.'); }catch(_){}
}
if (!data){
  console.log('::warning::No price data available. The website will show "not available yet".');
  data = {source: 'none', states: STATES, updated: '', fetchedAt: new Date().toISOString(), unit: 'INR per quintal', fields: FIELDS, rows: []};
}
await mkdir(dirname(OUT), {recursive: true});
await writeFile(OUT, JSON.stringify(data));
console.log('Saved ' + OUT);
