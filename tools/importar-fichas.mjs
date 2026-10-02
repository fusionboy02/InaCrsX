#!/usr/bin/env node
/* Importador de fichas de IE Cross Database
   Recorre las fichas publicadas en la web original y completa data/players.json
   con estadísticas, zonas, etiquetas, pasivas y supertécnicas de cada jugador.

   Uso (Node 18 o superior, sin instalar nada):
     node tools/importar-fichas.mjs                 -> importa todas las fichas
     node tools/importar-fichas.mjs --solo 2031     -> importa solo una (para probar)
     node tools/importar-fichas.mjs --depurar 2031  -> muestra el texto leído de esa ficha

   Al terminar, actualiza la fecha de data/meta.json para que las apps se refresquen. */
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ORIGEN = process.env.ORIGEN || 'https://iecrossdatabase.pages.dev';
const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PLAYERS = path.join(RAIZ, 'data', 'players.json');
const META = path.join(RAIZ, 'data', 'meta.json');
const PAUSA_MS = 350; // pausa entre peticiones para no saturar la web

/* ---------- HTML a texto plano conservando saltos de bloque ---------- */
export function htmlATexto(html){
  return html
    .replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|tr|section|article|header|footer|table|thead|tbody|ul|ol|dt|dd)>/gi, '\n')
    .replace(/<(td|th)[^>]*>/gi, ' | ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n))
    .split('\n').map(l => l.replace(/\s+/g, ' ').replace(/\*/g, '').trim()).filter(Boolean).join('\n');
}
const num = s => Number(String(s).replace(/\./g, '').replace(',', '.'));
const seccion = (t, desde, hasta) => {
  const a = t.search(desde); if (a < 0) return '';
  const resto = t.slice(a); const b = hasta ? resto.slice(1).search(hasta) : -1;
  return b < 0 ? resto : resto.slice(0, b + 1);
};
const FIN = /\n(Una base de fans|Otras versiones|IE CROSS DATABASE)/;

/* ---------- Lectura de una ficha ---------- */
export function leerFicha(texto){
  const t = texto;
  const stat = n => { const m = t.match(new RegExp(n + '\\s*\\|?\\s*([\\d.]+)')); return m ? num(m[1]) : null; };
  const stats = { Tiro: stat('Tiro'), 'Técnica': stat('Técnica'), Bloqueo: stat('Bloqueo'), Parada: stat('Parada') };
  const speed = stat('Velocidad'), tp = stat('TP');
  const level = Number((t.match(/NIV\.\s*(\d+)/) || [])[1]) || 440;

  // Zonas: secuencia de casillas 1..11 con una letra S/A/B delante
  const zonas = {};
  const zt = seccion(t, /Zonas ideales/, /S \+\d+%|\nEtiquetas/).replace(/Zonas ideales/, '');
  const cad = zt.replace(/\s+/g, ''); let i = cad.search(/[SAB]?1/);
  for (let n = 1; n <= 11 && i >= 0; n++){
    let letra = null; if (/[SAB]/.test(cad[i])){ letra = cad[i]; i++; }
    if (!cad.startsWith(String(n), i)) break;
    if (letra) zonas[n] = letra; i += String(n).length;
  }

  // Etiquetas
  const et = seccion(t, /\nEtiquetas\n/, /\nPasivas\n/);
  const tags = et.split('\n').filter(l => l && !/^Etiquetas$|^\d+$|Las pasivas de cohesión/.test(l))
    .flatMap(l => l.length > 40 ? [] : [l]);

  // Pasivas
  const pas = seccion(t, /\nPasivas\n/, /\nSupertécnicas\n/);
  const passives = [];
  const bloques = pas.split(/\n(?=(?:Nivel|Despertar)\n)/).slice(1);
  for (const b of bloques){
    const lin = b.split('\n').filter(Boolean);
    const src = lin[0];
    const name = lin[1];
    const lv = Number((b.match(/NIV\.\s*(\d+)/) || [])[1]) || null;
    const text = lin.filter(l => !/^(Nivel|Despertar)$|^NIV\.|Se desbloquea|^Despertar \d+$/.test(l) && l !== name).join(' ');
    const un = b.match(/Se desbloquea al nivel (\d+)/) ? 'nivel ' + b.match(/Se desbloquea al nivel (\d+)/)[1]
             : b.match(/Despertar (\d+)\s*$/m) ? 'despertar ' + b.match(/Despertar (\d+)\s*$/m)[1] : '';
    const p = { name: name.replace(/\s*·\s*/g, ': ').replace(/<([^>]+)>/g, '($1)'), src, lv, unlock: un, text };
    const c = text.match(/Si hay (\d+) o más aliados de (Fuego|Viento|Bosque|Montaña)/);
    if (c) p.cond = { type: 'element', el: { Fuego: 'F', Viento: 'V', Bosque: 'B', 'Montaña': 'M' }[c[2]], min: Number(c[1]) };
    passives.push(p);
  }

  // Supertécnicas
  const st = seccion(t, /\nSupertécnicas\n/, FIN);
  const techniques = [];
  const partes = st.split(/\n(?=[^\n|]+\nNivel \d+\n)/).slice(1);
  for (const b of partes){
    const lin = b.split('\n');
    const name = lin[0].trim(), unlock = Number((lin[1].match(/\d+/) || [])[0]);
    const meta = lin[2] || '';
    const EL = { Fuego: 'F', Viento: 'V', Bosque: 'B', 'Montaña': 'M' };
    const el = Object.keys(EL).find(k => meta.includes(k));
    const type = (meta.match(/^(Tiro|Regate|Bloqueo|Parada|Defensa|Pase)/) || [])[1] || meta.split(/(?=Fuego|Viento|Bosque|Montaña)/)[0];
    const rows = {};
    for (const l of lin){
      const cel = l.split('|').map(x => x.trim()).filter(Boolean);
      if (cel.length >= 11 && cel[0] !== 'Nivel' && !/^-+$/.test(cel[1])){
        rows[cel[0]] = cel.slice(1, 11).map(v => /%$/.test(v) ? v : (isNaN(num(v)) ? v : num(v)));
      }
    }
    techniques.push({ name, unlock, type, el: el ? EL[el] : null, long: /Tiro largo:\s*sí/i.test(meta), chain: /Cadena/.test(meta), rows });
  }
  return { tags, level, stats, speed, tp, zones: zonas, passives, techniques };
}

/* ---------- Descarga ---------- */
async function texto(url){
  const r = await fetch(url, { headers: { 'User-Agent': 'IECrossImportador/1.0' } });
  if (!r.ok) throw new Error(`${r.status} en ${url}`);
  return htmlATexto(await r.text());
}
async function enlacesFichas(){
  const html = await (await fetch(ORIGEN + '/jugadores')).text();
  const m = [...html.matchAll(/href="(?:https?:\/\/[^"]+)?\/jugador\/([a-z0-9-]+-(\d+))"/g)];
  return new Map(m.map(x => [Number(x[2]), x[1]]));
}
const dormir = ms => new Promise(r => setTimeout(r, ms));

async function main(){
  const args = process.argv.slice(2);
  const solo = args.includes('--solo') ? Number(args[args.indexOf('--solo') + 1]) : null;
  const depurar = args.includes('--depurar') ? Number(args[args.indexOf('--depurar') + 1]) : null;
  const players = JSON.parse(await readFile(PLAYERS, 'utf8'));
  const slugs = await enlacesFichas();
  console.log(`Fichas encontradas en ${ORIGEN}: ${slugs.size}`);
  if (depurar){ console.log(await texto(`${ORIGEN}/jugador/${slugs.get(depurar)}`)); return; }
  let ok = 0, fallos = [];
  for (const p of players){
    if (solo && p.id !== solo) continue;
    const slug = slugs.get(p.id); if (!slug){ fallos.push(`${p.id} sin enlace`); continue; }
    try{
      const d = leerFicha(await texto(`${ORIGEN}/jugador/${slug}`));
      const suma = Object.values(d.stats).reduce((a, b) => a + (b || 0), 0);
      if (!d.stats.Tiro || !d.techniques.length) throw new Error('no se reconocen estadísticas o técnicas');
      if (suma !== p.power) console.warn(`  Aviso ${p.id} ${p.name}: la suma de estadísticas (${suma}) no coincide con el poder (${p.power})`);
      p.detail = d; ok++;
      process.stdout.write(`\r${ok} fichas importadas`);
    } catch (e){ fallos.push(`${p.id} ${p.name}: ${e.message}`); }
    await dormir(PAUSA_MS);
  }
  await writeFile(PLAYERS, JSON.stringify(players, null, 1));
  const meta = JSON.parse(await readFile(META, 'utf8')); meta.updated = new Date().toISOString();
  await writeFile(META, JSON.stringify(meta, null, 1));
  console.log(`\nListo: ${ok} fichas guardadas en data/players.json y meta.json actualizado.`);
  if (fallos.length){ console.log(`No se pudieron leer ${fallos.length}:`); fallos.forEach(f => console.log('  ' + f)); console.log('Ejecuta con --depurar <id> y envía el texto que salga para ajustar el lector.'); }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch(e => { console.error(e.message); process.exit(1); });
