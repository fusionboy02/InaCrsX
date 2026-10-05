/* Lee la base de datos que la web original lleva dentro de sus scripts:
   jugadores, entrenadores y formaciones, nombres japoneses y traducciones oficiales,
   tier list, noticias y banners. Devuelve los datos ya en el formato de esta web. */
import vm from 'node:vm';

/* ---------- utilidades para leer literales de JavaScript minificado ---------- */
export function literal(t, i){
  let d = 0, q = null;
  for (let k = i; k < t.length; k++){
    const c = t[k];
    if (q){ if (c === '\\'){ k++; continue; } if (c === q) q = null; continue; }
    if (c === '"' || c === "'" || c === '`'){ q = c; continue; }
    if (c === '{' || c === '['){ d++; }
    else if (c === '}' || c === ']'){ d--; if (d === 0) return t.slice(i, k + 1); }
  }
  return null;
}
export function padre(t, i){
  let depth = 0;
  for (let k = i - 1; k > 0; k--){
    const c = t[k];
    if (c === '`'){ k = t.lastIndexOf('`', k - 1); continue; }
    if (c === '}' || c === ']') depth++;
    else if (c === '{' || c === '['){ if (depth === 0) return k; depth--; }
  }
  return -1;
}
const evaluar = s => vm.runInNewContext('(' + s + ')', { JSON }, { timeout: 5000 });
function buscar(scripts, prueba){
  for (const [nombre, t] of scripts){ const r = prueba(t); if (r != null) return { nombre, valor: r }; }
  return null;
}

/* ---------- localizar cada bloque de datos ---------- */
export function localizar(scripts){
  const out = {};
  const j = buscar(scripts, t => { const m = t.match(/players:\[\{id:`\d+`,slug:`/); return m ? evaluar(literal(t, m.index + 'players:'.length)) : null; });
  if (j) out.jugadores = j.valor;
  const ja = buscar(scripts, t => { const i = t.indexOf('lookup:JSON.parse('); return i > 0 ? evaluar(literal(t, padre(t, i))) : null; });
  if (ja) out.japones = ja.valor;
  const en = buscar(scripts, t => { const m = t.match(/\[\{id:`\d+`,name:`[^`]+`,romanizedName:`/); return m ? evaluar(literal(t, m.index)) : null; });
  if (en) out.entrenadores = en.valor;
  const enJa = buscar(scripts, t => { const m = t.match(/coaches:\{\d+:\{name:`[^`]+`,description:`/); return m ? evaluar(literal(t, m.index + 'coaches:'.length)) : null; });
  if (enJa) out.entrenadoresJa = enJa.valor;
  const tier = buscar(scripts, t => { const m = t.match(/\{updated:`[^`]+`,author:`[^`]*`,positions:\{/); return m ? evaluar(literal(t, m.index)) : null; });
  if (tier) out.tier = tier.valor;
  const nov = buscar(scripts, t => { const i = t.indexOf('activeBanners:'); return i > 0 ? evaluar(literal(t, padre(t, i))) : null; });
  if (nov) out.novedades = nov.valor;
  return out;
}

/* ---------- conversión al formato de esta web ---------- */
const EL = { Fuego:'F', Viento:'V', Bosque:'B', 'Montaña':'M' };
const sinEspacio = s => String(s || '').replace(/[\s　]+/g, '');
const pct = v => `${v} %`;
function condicionPasiva(texto){
  let m = texto.match(/al menos (\d+) aliados de (Fuego|Viento|Bosque|Montaña)/i);
  if (m) return { type:'element', el: EL[m[2]], min: Number(m[1]) };
  m = texto.match(/al menos (\d+) aliados con la etiqueta ([^,.]+)/i);
  if (m) return { type:'tag', tag: m[2].trim(), min: Number(m[1]) };
  return null;
}
export function convertirJugadores(datos, anteriores = []){
  const previo = new Map(anteriores.map(p => [p.id, p]));
  const jaJ = datos.japones?.players || {}, jaT = datos.japones?.lookup?.techniques || {}, jaP = datos.japones?.lookup?.passiveNames || {};
  return datos.jugadores.map(r => {
    const id = Number(r.id), viejo = previo.get(id) || {};
    const techniques = (r.techniques || []).map(t => ({
      name: t.name, nameJP: jaT[t.name] || '', code: t.code, unlock: t.unlock, type: t.type, el: EL[t.element] || null,
      long: t.type === 'Tiro' ? !!t.shootBlock : false, blocksShots: t.type !== 'Tiro' ? !!t.shootBlock : false, chain: !!t.chain,
      rows: {
        Poder: t.levels.map(l => l.power), 'Coste TP': t.levels.map(l => l.tp), Rango: t.levels.map(l => l.range),
        Recarga: t.levels.map(l => l.cooldown), Falta: t.levels.map(l => pct(l.foul)), 'Crítico': t.levels.map(l => pct(l.critical)),
        'Bonus crítico': t.levels.map(l => pct(l.criticalBonus))
      }
    }));
    const passives = (r.passives || []).map(p => {
      const o = { code: p.code, name: p.name, nameJP: jaP[p.name] || '', src: p.source, lv: p.level, rank: p.rank,
        unlock: `${p.source === 'Despertar' ? 'despertar' : 'nivel'} ${p.unlock}`, text: p.description };
      if (p.stack) o.stack = true;
      const c = condicionPasiva(p.description); if (c) o.cond = c;
      return o;
    });
    const zonas = {}; (r.zones || []).forEach(z => { zonas[z.area] = z.rank; });
    const alias = (r.aliases || []).filter(a => a !== viejo.nameEU);
    return {
      id, slug: r.slug,
      // Los nombres ya revisados se conservan; los jugadores nuevos usan los de la web original.
      name: viejo.name || r.name,
      nameEU: viejo.nameEU || (r.aliases || [])[0] || '',
      nameJP: sinEspacio(jaJ[r.id]?.name) || viejo.nameJP || '', nickJP: sinEspacio(jaJ[r.id]?.nickname) || '',
      alias: alias.join(', '),
      team: r.team, pos: r.position, el: EL[r.element], stars: r.stars, power: r.stats.power, isNew: !!r.new,
      detail: {
        tags: r.tags || [], level: datos.nivel || 440,
        stats: { Tiro: r.stats.kick, 'Técnica': r.stats.technique, Bloqueo: r.stats.block, Parada: r.stats.catch },
        speed: r.stats.speed, tp: r.stats.tp, zones: zonas, passives, techniques
      }
    };
  });
}
function efecto(e){
  const tipo = String(e.effectType || '').replace(/^Modificador de /i, '');
  const target = String(e.target || '');
  const pos = (target.match(/posición recomendada \[(\w+)\]/) || [])[1] || null;
  const tag = (target.match(/etiqueta \[([^\]]+)\]/) || [])[1] || null;
  const els = [...target.matchAll(/elemento \[([^\]]+)\]/g)].map(m => EL[m[1]]).filter(Boolean);
  const rival = /^(rival|enemigo)/i.test(target);
  return { label: `${tipo.charAt(0).toUpperCase() + tipo.slice(1)} ${e.value < 0 ? '−' + Math.abs(e.value) : '+' + e.value}`, value: e.value, pos, tag, els: els.length ? els : null, rival, stack: !!e.stackable && !!e.endConditionId };
}
export function convertirEntrenadores(datos, anteriores = {}){
  const prev = new Map((anteriores.coaches || []).map(c => [c.id, c]));
  const jaC = datos.entrenadoresJa || {};
  const layouts = { ...(anteriores.layouts || {}) };
  const coaches = datos.entrenadores.map(c => {
    const f = c.formation, fid = String(f.id), viejo = prev.get(Number(c.id)) || {};
    layouts[fid] = f.slots.map(s => ({ n: s.slot, pos: s.position,
      x: Math.round(Math.min(89, Math.max(11, 50 + s.screenX * 46))), y: Math.round(Math.min(91, Math.max(9, 90 - s.screenY * 87))) }));
    const niveles = (c.growth || []).map(g => ({ level: g.level, name: g.coachPassive.name, text: g.coachPassive.description, effects: g.coachPassive.effects.map(efecto) }));
    const max = niveles[niveles.length - 1];
    return {
      id: Number(c.id), name: c.romanizedName || c.name, nameEU: viejo.nameEU || '', nameJP: sinEspacio(jaC[c.id]?.name) || viejo.nameJP || '',
      formation: f.name, layout: fid,
      conditions: f.slots.filter(s => s.condition).map(s => ({ slot: s.slot, type: s.condition.type, value: s.condition.value })),
      passive: max ? { name: max.name, text: max.text, effects: max.effects } : null,
      passiveByLevel: niveles,
      formationPassive: f.activePassive ? { name: f.activePassive.name, text: f.activePassive.description, effects: f.activePassive.effects.map(efecto) } : null,
      level: max?.level || 10
    };
  });
  return { layouts, coaches };
}
const MESES = { ENE:0, FEB:1, MAR:2, ABR:3, MAY:4, JUN:5, JUL:6, AGO:7, SEP:8, SEPT:8, OCT:9, NOV:10, DIC:11 };
const fecha = s => { const m = String(s || '').match(/(\d{1,2}) ([A-Z]+) (\d{4})/); return m ? new Date(Date.UTC(+m[3], MESES[m[2]] ?? 0, +m[1])).toISOString().slice(0, 10) : null; };
const tipoNoticia = l => /PICK|GACHA/i.test(l) ? 'gacha' : /EVENTO/i.test(l) ? 'evento' : /TIENDA/i.test(l) ? 'tienda' : 'contenido';
const archivo = p => String(p || '').replace(/^\/?news\//, '');
export function convertirNovedades(n, eventosPrevios = []){
  const news = (n.items || []).map(x => ({ date: fecha(x.date), kind: tipoNoticia(x.label), label: x.label, title: x.title, summary: x.summary,
    img: archivo(x.image), points: x.details || [], player: x.playerId ? Number(x.playerId) : undefined, source: x.sourceUrl }));
  const banners = (n.activeBanners || []).map(b => ({ id: b.id, kind: 'gacha', title: `Gacha destacado de ${b.title}`, text: b.label === 'PICK-UP ACTIVO' ? 'Banner con probabilidad aumentada.' : (b.label || ''),
    start: null, end: b.endsAt, img: archivo(b.image), player: b.playerId ? Number(b.playerId) : undefined, source: b.sourceUrl }));
  if (n.nextUpdate) banners.push({ id: 'proxima-actualizacion', kind: 'contenido', title: n.nextUpdate.title, text: n.nextUpdate.summary || '', start: n.nextUpdate.startsAt || null, end: null, img: archivo(n.nextUpdate.image) });
  // Se conservan los eventos que no son gachas y siguen vigentes (evento, tienda, contenido añadidos aparte)
  const ahora = Date.now();
  const otros = eventosPrevios.filter(e => e.kind !== 'gacha' && e.id !== 'proxima-actualizacion' && (!e.end || Date.parse(e.end) > ahora));
  return { news, events: [...banners, ...otros] };
}
export function convertirTier(tier){
  const out = {};
  for (const [pos, filas] of Object.entries(tier.positions || {})){
    out[pos] = { updated: tier.updated, tiers: Object.fromEntries(Object.entries(filas).map(([k, ids]) => [k, ids.map(Number)])) };
  }
  return out;
}
/* Diccionario japonés → español generado con las traducciones oficiales */
export function diccionarioOficial(datos, jugadores){
  const tecnicas = {};
  const elDe = new Map(); jugadores.forEach(p => (p.detail?.techniques || []).forEach(t => elDe.set(t.name, t.el)));
  for (const [es, jp] of Object.entries(datos.japones?.lookup?.techniques || {})) tecnicas[jp] = [es, elDe.get(es) || null];
  return { tecnicas };
}
