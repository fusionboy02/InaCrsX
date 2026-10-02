#!/usr/bin/env node
/* Sincronización automática de IE Cross Database
   La ejecuta el robot de GitHub (.github/workflows/sincronizar.yml) cada pocas horas.
   1. Lee el catálogo y todas las fichas de la web original (jugadores nuevos, estadísticas,
      pasivas, técnicas, zonas, etiquetas).
   2. Lee los equipos recomendados de pruebas de inacross-guide y los traduce con
      data/diccionario.json.
   3. Guarda el texto de las demás páginas en tools/fuentes/ para poder ampliar el lector.
   4. Copia aquí las fotos de jugadores, entrenadores y noticias que aún no estén.
   4. Solo escribe un archivo si lo leído es válido y distinto de lo que ya había, y en ese
      caso cambia data/meta.json para que todas las apps se actualicen.

   Uso manual:  node tools/sincronizar.mjs            (todo)
                node tools/sincronizar.mjs --sin-fichas (solo inacross-guide y fuentes)  */
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { htmlATexto, leerFicha } from './importar-fichas.mjs';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const D = f => path.join(RAIZ, 'data', f);
const ORIGEN = process.env.ORIGEN || 'https://iecrossdatabase.pages.dev';
const GUIA = 'https://inacross-guide.com';
const FUENTES_GUIA = ['/trials', '/club-trials', '/pvp', '/pvp/environments/ver-1-3-3', '/limited', '/cross-simulator', '/training', '/players', '/help', '/help/beginner', '/help/tier-list', '/calendar'];
const FUENTES_ORIGEN = ['/', '/calendario', '/tier-list', '/formacion', '/jugadores'];
const PAUSA = 350, dormir = ms => new Promise(r => setTimeout(r, ms));
const leerJSON = async f => JSON.parse(await readFile(D(f), 'utf8'));
const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b);
async function bajar(url){
  const r = await fetch(url, { headers: { 'User-Agent': 'IECrossSync/1.0 (+web fan)' } });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.text();
}
const log = (...a) => console.log(...a);

/* ---------------- 1. Web original: catálogo y fichas ---------------- */
const ELS = { Fuego:'F', Viento:'V', Bosque:'B', 'Montaña':'M' };
export function leerCabecera(html){
  const h1 = (html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || [])[1];
  const name = h1 ? htmlATexto(h1).replace(/\n/g, ' ').trim() : null;
  const t = htmlATexto(html);
  const i = name ? t.indexOf(name) : -1;
  const antes = i > 0 ? t.slice(Math.max(0, i - 200), i) : '';
  const despues = i >= 0 ? t.slice(i + name.length, i + name.length + 600) : t;
  const power = Number(((t.match(/PODER BASE\s*([\d.]+)/i) || [])[1] || '').replace(/\./g, '')) || null;
  const pos = (despues.match(/\b(GK|DF|MF|FW)\b/) || [])[1] || null;
  const elw = (despues.match(/(Fuego|Viento|Bosque|Montaña)/) || [])[1];
  const stars = ((despues.match(/★+/) || [''])[0]).length || null;
  const isNew = /NUEVO/i.test(antes);
  const team = antes.split('\n').map(s => s.trim()).filter(s => s && !/^(GK|DF|MF|FW)$|NUEVO|Inicio|Jugadores|Volver/i.test(s)).pop() || null;
  return { name, power, pos, el: elw ? ELS[elw] : null, stars, isNew, team };
}
async function sincronizarJugadores(){
  const players = await leerJSON('players.json');
  const byId = new Map(players.map(p => [p.id, p]));
  const html = await bajar(ORIGEN + '/jugadores');
  const enlaces = [...html.matchAll(/href="(?:https?:\/\/[^"]+)?\/jugador\/([a-z0-9-]+-(\d+))"/g)];
  const slugs = new Map(enlaces.map(m => [Number(m[2]), m[1]]));
  if (slugs.size < Math.max(50, players.length * 0.8)) throw new Error(`catálogo sospechoso: solo ${slugs.size} fichas`);
  const nuevos = [], fallos = [];
  for (const [id, slug] of slugs){
    try{
      const ph = await bajar(`${ORIGEN}/jugador/${slug}`);
      const cab = leerCabecera(ph), det = leerFicha(htmlATexto(ph));
      let p = byId.get(id);
      if (!p){
        if (!cab.name || !cab.pos || !cab.el) throw new Error('cabecera incompleta');
        p = { id, name: cab.name, alias: '', nameEU: '', nameJP: '', team: cab.team || det.tags[0] || '', pos: cab.pos, el: cab.el, stars: cab.stars || 1, power: cab.power || 0, isNew: true, detail: null };
        players.push(p); byId.set(id, p); nuevos.push(cab.name);
      } else {
        // Los nombres ya revisados no se tocan; el resto se actualiza desde la ficha.
        if (cab.power) p.power = cab.power; if (cab.stars) p.stars = cab.stars;
        if (cab.pos) p.pos = cab.pos; if (cab.el) p.el = cab.el;
        p.isNew = cab.isNew;
      }
      if (det.stats.Tiro && det.techniques.length) p.detail = det;
    } catch (e){ fallos.push(`${id}: ${e.message}`); }
    await dormir(PAUSA);
  }
  log(`Web original: ${slugs.size} fichas leídas, ${nuevos.length} jugadores nuevos${nuevos.length ? ' (' + nuevos.join(', ') + ')' : ''}, ${fallos.length} fallos.`);
  fallos.slice(0, 10).forEach(f => log('  ' + f));
  return players;
}

/* ---------------- 2. inacross-guide: equipos de pruebas ---------------- */
const EL_JP = { '山':'M', '風':'V', '林':'B', '火':'F' };
export function leerPruebas(texto, dic){
  const out = [], pendientes = new Set();
  const cab = /(攻撃|守備)・(山|風|林|火)の試練1〜10位/g;
  const marcas = [...texto.matchAll(cab)];
  marcas.forEach((m, k) => {
    const trozo = texto.slice(m.index, k + 1 < marcas.length ? marcas[k + 1].index : undefined);
    const mode = m[1] === '攻撃' ? 'ataque' : 'defensa', el = EL_JP[m[2]];
    const lineas = trozo.split('\n').map(s => s.trim());
    let rank = null, titulo = '';
    for (const l of lineas){
      const r = l.match(/^(?:\d+\.\s*)?(\d+)位(.*)$/); if (r){ rank = Number(r[1]); titulo = r[2]; continue; }
      const piezas = l.split('→').map(s => s.trim());
      if (rank && piezas.length === 5 && piezas.every(s => /「.+」/.test(s))){
        const lineup = piezas.map(s => {
          const [, pj, tj] = s.match(/^(.+?)「(.+)」$/);
          const id = dic.jugadores[pj];
          const tech = dic.tecnicas[tj];
          if (!id) pendientes.add('jugador: ' + pj);
          if (!tech) pendientes.add('técnica: ' + tj);
          const e = { id: id || null, el: tech ? tech[1] : null, tech: tech ? tech[0] : tj, techJP: tj };
          if (dic.manuales.includes(`${pj}|${tj}`)) e.manual = true;
          return e;
        });
        // Los nombres van separados por «・», pero algunos lo contienen (フェイ・ルーン): se unen los trozos que forman un nombre conocido.
        const trozos = ((titulo.match(/（(.+?)入り）/) || [])[1] || '').split('・'), con = [];
        for (let a = 0; a < trozos.length;){
          let b = trozos.length;
          for (; b > a; b--){ const n = trozos.slice(a, b).join('・'); const id = dic.cortos[n] || dic.jugadores[n]; if (id){ con.push(id); break; } }
          a = b > a ? b : a + 1;
        }
        const etiqueta = Object.entries(dic.etiquetas).find(([jp]) => titulo.includes(jp));
        const item = { el, mode, rank, with: con, lineup };
        if (etiqueta) item.label = etiqueta[1];
        out.push(item); rank = null;
      }
    }
  });
  // Elemento de técnicas desconocidas: el del propio jugador (se marcan como pendientes)
  return { trials: out, pendientes: [...pendientes] };
}
async function sincronizarPruebas(players){
  const dic = await leerJSON('diccionario.json');
  const texto = htmlATexto(await bajar(GUIA + '/trials'));
  const { trials, pendientes } = leerPruebas(texto, dic);
  const pj = new Map(players.map(p => [p.id, p]));
  trials.forEach(t => t.lineup.forEach(m => { if (!m.el && m.id) m.el = pj.get(m.id)?.el || 'F'; }));
  const validos = trials.filter(t => t.lineup.every(m => m.id));
  log(`inacross-guide: ${trials.length} equipos de pruebas leídos, ${validos.length} completos, ${pendientes.length} términos pendientes de traducir.`);
  if (validos.length < 40) throw new Error('muy pocos equipos de pruebas: no se sobrescribe nada');
  return { trials: validos, pendientes };
}

/* ---------------- 3. Copias de texto de las demás páginas ---------------- */
async function guardarFuentes(){
  const dir = path.join(RAIZ, 'tools', 'fuentes'); await mkdir(dir, { recursive: true });
  for (const [base, rutas, pref] of [[GUIA, FUENTES_GUIA, 'inacross'], [ORIGEN, FUENTES_ORIGEN, 'original']]){
    for (const r of rutas){
      try{ await writeFile(path.join(dir, `${pref}${r.replace(/\//g, '_') || '_inicio'}.txt`), htmlATexto(await bajar(base + r))); }
      catch (e){ log(`  No se pudo guardar ${base + r}: ${e.message}`); }
      await dormir(PAUSA);
    }
  }
}


/* ---------------- 4. Copia de imágenes en este repositorio ---------------- */
// Así la web nueva tiene sus propias fotos aunque la original desaparezca. Solo baja las que faltan.
const existe = async f => { try{ await access(f); return true; } catch { return false; } };
async function copiarImagenes(players){
  const rutas = new Set();
  players.forEach(p => rutas.add(`players/database/${p.id}.png`));
  const coaches = await leerJSON('coaches.json').catch(() => ({ coaches: [] }));
  (coaches.coaches || []).forEach(c => rutas.add(`coaches/small/${c.id}.png`));
  for (const f of ['events.json', 'news.json']){
    const lista = await leerJSON(f).catch(() => []);
    (Array.isArray(lista) ? lista : []).forEach(x => x.img && rutas.add(`news/${x.img}`));
  }
  let nuevas = 0, fallos = 0;
  for (const r of rutas){
    const destino = path.join(RAIZ, r);
    if (await existe(destino)) continue;
    try{
      const res = await fetch(`${ORIGEN}/${r}`, { headers: { 'User-Agent': 'IECrossSync/1.0 (+web fan)' } });
      if (!res.ok || !/^image\//.test(res.headers.get('content-type') || '')) throw new Error(String(res.status));
      await mkdir(path.dirname(destino), { recursive: true });
      await writeFile(destino, Buffer.from(await res.arrayBuffer())); nuevas++;
    } catch { fallos++; }
    await dormir(120);
  }
  log(`Imágenes: ${nuevas} copiadas, ${fallos} no disponibles, ${rutas.size - nuevas - fallos} ya estaban.`);
}

/* ---------------- Principal ---------------- */
async function main(){
  const sinFichas = process.argv.includes('--sin-fichas');
  let cambios = false;
  const playersAntes = await leerJSON('players.json');
  let players = playersAntes;
  if (!sinFichas){
    try{ players = await sincronizarJugadores(); if (!igual(players, playersAntes)){ await writeFile(D('players.json'), JSON.stringify(players, null, 1)); cambios = true; } }
    catch (e){ log('Jugadores sin cambios: ' + e.message); players = playersAntes; }
  }
  try{
    const { trials, pendientes } = await sincronizarPruebas(players);
    const guides = await leerJSON('guides.json');
    if (!igual(guides.trials, trials)){ guides.trials = trials; await writeFile(D('guides.json'), JSON.stringify(guides, null, 1)); cambios = true; }
    await writeFile(D('pendientes.json'), JSON.stringify({ fecha: new Date().toISOString(), pendientes }, null, 1));
  } catch (e){ log('Pruebas sin cambios: ' + e.message); }
  await guardarFuentes();
  try{ await copiarImagenes(players); } catch (e){ log('Imágenes: ' + e.message); }
  if (cambios){
    const meta = await leerJSON('meta.json'); meta.updated = new Date().toISOString();
    await writeFile(D('meta.json'), JSON.stringify(meta, null, 1));
    log('Datos actualizados: las apps se refrescarán solas.');
  } else log('Sin cambios en los datos.');
}
if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch(e => { console.error(e); process.exit(1); });
