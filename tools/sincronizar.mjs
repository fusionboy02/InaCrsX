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
import * as X from './extraer.mjs';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const D = f => path.join(RAIZ, 'data', f);
const ORIGEN = process.env.ORIGEN || 'https://iecrossdatabase.pages.dev';
const GUIA = process.env.GUIA || 'https://inacross-guide.com';
const FUENTES_GUIA = ['/trials', '/club-trials', '/pvp', '/pvp/environments/ver-1-3-3', '/limited', '/cross-simulator', '/training', '/players', '/help', '/help/beginner', '/help/tier-list', '/calendar'];
const FUENTES_ORIGEN = ['/', '/calendario', '/tier-list', '/formacion', '/jugadores', '/jugador/torch-2031', '/jugador/kino-aki-1166', '/jugador/afuro-terumi-1164'];
const PAUSA = 350, dormir = ms => new Promise(r => setTimeout(r, ms));
const leerJSON = async f => JSON.parse(await readFile(D(f), 'utf8'));
const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b);
async function bajar(url){
  const r = await fetch(url, { headers: { 'User-Agent': 'IECrossSync/1.0 (+web fan)' } });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.text();
}
const log = (...a) => console.log(...a);


/* ---------------- 0. Base de datos de los scripts de la web original ---------------- */
async function descargarScripts(){
  const scripts = new Map(), pendientes = [], css = new Map();
  for (const ruta of ['/', '/jugadores', '/formacion', '/jugador/torch-2031']){
    try{
      const html = await bajar(ORIGEN + ruta);
      for (const m of html.matchAll(/(?:src|href)="(\/[^"]+\.m?js)"/g)) pendientes.push(m[1]);
      for (const m of html.matchAll(/href="(\/[^"]+\.css)"/g)) if (!css.has(m[1])) css.set(m[1], null);
    } catch (e){ log('  ' + e.message); }
  }
  while (pendientes.length && scripts.size < 80){
    const s = pendientes.shift(); if (scripts.has(s)) continue;
    try{
      const js = await bajar(ORIGEN + s); scripts.set(s, js);
      const base = s.slice(0, s.lastIndexOf('/') + 1);
      for (const m of js.matchAll(/(?:from\s*|import\s*\(\s*)["'`](\.{1,2}\/[^"'`]+\.m?js)["'`]/g)) pendientes.push(new URL(m[1], 'https://x' + base).pathname);
      for (const m of js.matchAll(/["'`](\/_next\/[^"'`]+\.m?js)["'`]/g)) pendientes.push(m[1]);
    } catch {}
  }
  for (const c of css.keys()){ try{ css.set(c, await bajar(ORIGEN + c)); } catch {} }
  return { scripts, css };
}
async function sincronizarDesdeScripts(){
  const { scripts, css } = await descargarScripts();
  // Copia de la hoja de estilos (sirve para revisar el mapa de zonas)
  const dirHtml = path.join(RAIZ, 'tools', 'fuentes', 'html'); await mkdir(dirHtml, { recursive: true });
  for (const [r, txt] of css) if (txt) await writeFile(path.join(dirHtml, r.replace(/^\//, '').replace(/\//g, '__')), txt);
  const datos = X.localizar(scripts);
  datos.nombresManuales = await leerJSON('nombres.json').then(n => n.europeo || {}).catch(() => ({}));
  log(`Web original: ${scripts.size} scripts; datos encontrados: ${Object.keys(datos).join(', ') || 'ninguno'}.`);
  if (!datos.jugadores || datos.jugadores.length < 50) throw new Error('no se encontró la base de jugadores en los scripts');
  const res = { cambios: [] };
  const playersPrev = await leerJSON('players.json');
  const players = X.convertirJugadores(datos, playersPrev);
  const nuevos = players.filter(p => !playersPrev.some(q => q.id === p.id)).map(p => p.name);
  if (!igual(players, playersPrev)){ await writeFile(D('players.json'), JSON.stringify(players, null, 1)); res.cambios.push('jugadores'); }
  log(`  Jugadores: ${players.length} (${nuevos.length} nuevos${nuevos.length ? ': ' + nuevos.join(', ') : ''}).`);
  if (datos.entrenadores?.length){
    const prev = await leerJSON('coaches.json').catch(() => ({}));
    const co = X.convertirEntrenadores(datos, prev);
    if (!igual(co, prev)){ await writeFile(D('coaches.json'), JSON.stringify(co, null, 1)); res.cambios.push('entrenadores'); }
    log(`  Entrenadores: ${co.coaches.length}.`);
  }
  if (datos.tier){
    const prev = await leerJSON('tiers.json').catch(() => ({})), t = X.convertirTier(datos.tier);
    if (!igual(t, prev)){ await writeFile(D('tiers.json'), JSON.stringify(t, null, 1)); res.cambios.push('tier list'); }
  }
  if (datos.novedades){
    const evPrev = await leerJSON('events.json').catch(() => []), nwPrev = await leerJSON('news.json').catch(() => []);
    const n = X.convertirNovedades(datos.novedades, evPrev);
    if (!igual(n.events, evPrev)){ await writeFile(D('events.json'), JSON.stringify(n.events, null, 1)); res.cambios.push('eventos'); }
    if (!igual(n.news, nwPrev)){ await writeFile(D('news.json'), JSON.stringify(n.news, null, 1)); res.cambios.push('noticias'); }
  }
  // Diccionario oficial japonés-español para leer inacross-guide
  const dic = await leerJSON('diccionario.json'), of = X.diccionarioOficial(datos, players);
  const tec = { ...dic.tecnicas };
  for (const [jp, [es, el]] of Object.entries(of.tecnicas)) tec[jp] = [es, el || dic.tecnicas[jp]?.[1] || null];
  if (!igual(tec, dic.tecnicas)){ dic.tecnicas = tec; await writeFile(D('diccionario.json'), JSON.stringify(dic, null, 1)); }
  if (datos.japones?.meta?.gameVersion){
    const meta = await leerJSON('meta.json'); if (meta.version !== datos.japones.meta.gameVersion){ meta.version = datos.japones.meta.gameVersion; await writeFile(D('meta.json'), JSON.stringify(meta, null, 1)); res.cambios.push('versión'); }
  }
  res.players = players;
  return res;
}

/* ---------------- 1. Web original: catálogo y fichas (plan B) ---------------- */
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
const SUFIJO_EQUIPO = { '帝国':'Imperius', 'イナズマジャパン':'Inazuma Japan', '雷門':'Raimon', 'ゼウス':'Zeus', 'カオス':'Caos' };
export function buscarJugador(nombre, dic, players){
  if (dic.jugadores[nombre]) return dic.jugadores[nombre];
  if (dic.cortos[nombre]) return dic.cortos[nombre];
  const m = nombre.match(/^(.+?)（(.+)）$/), base = m ? m[1] : nombre, eq = m ? SUFIJO_EQUIPO[m[2]] : null;
  let c = players.filter(p => p.nameJP === base);
  if (!c.length) c = players.filter(p => p.nickJP === base);
  if (eq) c = c.filter(p => p.team === eq);
  c.sort((x, y) => y.stars - x.stars || y.power - x.power);
  return c[0]?.id || null;
}
export function leerPruebas(texto, dic, players = []){
  const out = [], pendientes = new Set(), porId = new Map(players.map(p => [p.id, p]));
  const marcas = [...texto.matchAll(/(攻撃|守備)・(山|風|林|火)\s*の試練\s*1〜\s*10\s*位/g)];
  marcas.forEach((m, k) => {
    const trozo = texto.slice(m.index + m[0].length, k + 1 < marcas.length ? marcas[k + 1].index : undefined);
    const mode = m[1] === '攻撃' ? 'ataque' : 'defensa', el = EL_JP[m[2]];
    let rank = null, titulo = '';
    for (const l0 of trozo.split('\n')){
      const l = l0.trim();
      const r = l.match(/(?:^|⌄\s*)(\d+)\s*位\s*(.+)$/);
      if (r && !l.includes('「')){ rank = Number(r[1]); titulo = r[2]; continue; }
      const piezas = l.split(/\s*→\s*/);
      if (!rank || piezas.length !== 5 || !piezas.every(x => /^.+「.+」$/.test(x))) continue;
      const lineup = piezas.map(x => {
        const [, pj, tj] = x.match(/^(.+?)「(.+)」$/);
        const id = buscarJugador(pj, dic, players);
        const tr = dic.tecnicas[tj];
        if (!id) pendientes.add('jugador: ' + pj);
        if (!tr) pendientes.add('técnica: ' + tj);
        const propia = id && tr ? (porId.get(id)?.detail?.techniques || []).find(t => t.name === tr[0]) : null;
        let tech = tr ? tr[0] : tj, tel = propia?.el || (tr ? tr[1] : porId.get(id)?.el || null);
        const e = { id, el: tel, tech, techJP: tj };
        if (dic.manuales.includes(`${pj}|${tj}`) || dic.manuales.includes(`${(pj.match(/^(.+?)（/)||[])[1]}|${tj}`)) e.manual = true;
        return e;
      });
      const trozos = ((titulo.match(/（(.+)入り）/) || [])[1] || '').split('・'), con = [];
      for (let a = 0; a < trozos.length;){
        let b = trozos.length;
        for (; b > a; b--){ const id = buscarJugador(trozos.slice(a, b).join('・'), dic, players); if (id){ con.push(id); break; } }
        a = b > a ? b : a + 1;
      }
      const etiqueta = Object.entries(dic.etiquetas).find(([jp]) => titulo.includes(jp));
      const item = { el, mode, rank, with: con, lineup };
      if (etiqueta) item.label = etiqueta[1];
      out.push(item); rank = null;
    }
  });
  return { trials: out, pendientes: [...pendientes] };
}
async function sincronizarPruebas(players){
  const dic = await leerJSON('diccionario.json');
  const texto = htmlATexto(await bajar(GUIA + '/trials'));
  const { trials, pendientes } = leerPruebas(texto, dic, players);
  const pj = new Map(players.map(p => [p.id, p]));
  trials.forEach(t => t.lineup.forEach(m => { if (!m.el && m.id) m.el = pj.get(m.id)?.el || 'F'; }));
  const validos = trials.filter(t => t.lineup.every(m => m.id));
  log(`inacross-guide: ${trials.length} equipos de pruebas leídos, ${validos.length} completos, ${pendientes.length} términos pendientes de traducir.`);
  if (validos.length < 40) throw new Error('muy pocos equipos de pruebas: no se sobrescribe nada');
  return { trials: validos, pendientes };
}

/* ---------------- 3. Copias de texto de las demás páginas ---------------- */
async function guardarFuentes(){
  const dir = path.join(RAIZ, 'tools', 'fuentes'), raw = path.join(dir, 'html');
  await mkdir(raw, { recursive: true });
  const scripts = new Set();
  for (const [base, rutas, pref] of [[GUIA, FUENTES_GUIA, 'inacross'], [ORIGEN, FUENTES_ORIGEN, 'original']]){
    for (const r of rutas){
      try{
        const html = await bajar(base + r), nombre = `${pref}${r.replace(/\//g, '_') || '_inicio'}`;
        await writeFile(path.join(dir, nombre + '.txt'), htmlATexto(html));
        if (pref === 'original'){
          await writeFile(path.join(raw, nombre + '.html'), html);
          for (const m of html.matchAll(/(?:src|href)="(\/[^"]+\.(?:m?js|json))"/g)) scripts.add(m[1]);
        }
      } catch (e){ log(`  No se pudo guardar ${base + r}: ${e.message}`); }
      await dormir(PAUSA);
    }
  }
  // Fichas individuales de cada jugador en la guía japonesa
  try{
    const lista = await bajar(GUIA + '/players');
    const fichas = [...new Set([...lista.matchAll(/href="(\/players\/[a-z0-9-]+)"/g)].map(m => m[1]))];
    for (const f of fichas){
      try{ await writeFile(path.join(dir, 'inacross' + f.replace(/\//g, '_') + '.txt'), htmlATexto(await bajar(GUIA + f))); } catch {}
      await dormir(PAUSA);
    }
    log(`Fichas de la guía japonesa guardadas: ${fichas.length}.`);
  } catch (e){ log('  Fichas de la guía japonesa: ' + e.message); }
  // Scripts y datos que usa la web original (ahí están los entrenadores y sus formaciones)
  const vistos = new Set();
  for (const s of scripts){
    if (true) break; vistos.add(s);
    try{
      const js = await bajar(ORIGEN + s);
      await writeFile(path.join(raw, s.replace(/^\//, '').replace(/\//g, '__')), js);
      for (const m of js.matchAll(/["'`](\/[\w\-/.]+\.(?:json|m?js))["'`]/g)) if (!vistos.has(m[1])) scripts.add(m[1]);
    } catch {}
    await dormir(150);
  }
  log(`Fuentes: ${vistos.size} scripts y datos de la web original guardados para revisión.`);
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
  try{
    const r = await sincronizarDesdeScripts();
    players = r.players; if (r.cambios.length){ cambios = true; log('  Cambios: ' + r.cambios.join(', ') + '.'); }
  } catch (e){
    log('Lectura de scripts sin éxito (' + e.message + '); se leen las fichas una a una.');
    if (!sinFichas){
      try{ players = await sincronizarJugadores(); if (!igual(players, playersAntes)){ await writeFile(D('players.json'), JSON.stringify(players, null, 1)); cambios = true; } }
      catch (e2){ log('Jugadores sin cambios: ' + e2.message); players = playersAntes; }
    }
  }
  try{
    const { trials, pendientes } = await sincronizarPruebas(players);
    const guides = await leerJSON('guides.json');
    if (!igual(guides.trials, trials)){
      const firma = (lista, k) => JSON.stringify((lista || []).find(t => `${t.el}-${t.mode}` === k && t.rank === 1)?.lineup?.map(m => m.id));
      Object.keys(guides.trialNotes || {}).forEach(k => { if (firma(guides.trials, k) !== firma(trials, k)) delete guides.trialNotes[k]; });
      guides.trials = trials; await writeFile(D('guides.json'), JSON.stringify(guides, null, 1)); cambios = true;
    }
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
