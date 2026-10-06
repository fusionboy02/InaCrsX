# IE Cross Database: cómo publicarla y mantenerla

## Se actualiza sola

Un robot gratuito de GitHub (`.github/workflows/sincronizar.yml`) se ejecuta cada 4 horas y hace esto:

1. Lee el catálogo y todas las fichas de la web original. Añade los jugadores nuevos y actualiza estadísticas, pasivas, técnicas, zonas y etiquetas.
2. Lee los equipos recomendados de pruebas de inacross-guide y los traduce con `data/diccionario.json`.
2. Copia en este repositorio las fotos de jugadores, entrenadores y noticias que aún no tenga, para que la web no dependa de la original. Mientras falte alguna, se carga desde la web original.
3. Si algo ha cambiado, guarda los datos y cambia `data/meta.json`. Cloudflare publica la web en un minuto y las apps instaladas se refrescan solas.

Para comprobar que funciona: en GitHub, pestaña **Actions → Sincronizar datos → Run workflow**. En un par de minutos verás el resumen: fichas leídas, jugadores nuevos y equipos de pruebas.

Si la carpeta `.github` no se sube al arrastrar los archivos (en Mac y Windows a veces queda oculta), crea el robot a mano: pestaña **Actions → set up a workflow yourself**, pega el contenido de `sincronizar.yml` y guarda con **Commit changes**.

Detalles a tener en cuenta:

- **Seguridad de los datos:** el robot nunca borra datos. Si una web no responde o cambia de diseño y lo que lee no parece correcto, deja lo que había y lo apunta en el registro de la ejecución.
- **Términos nuevos:** cuando inacross-guide use un jugador o una técnica que el diccionario no conoce, aparecerá en `data/pendientes.json`. Añádelo a `data/diccionario.json` y en la siguiente ejecución entrará solo. Mientras tanto, ese equipo no se muestra.
- **Resto de páginas:** de las páginas que todavía no se traducen solas (duelos 1.3.3, batalla limitada, Cross Simulator, entrenamiento, evaluaciones y el calendario y las noticias de la web original), el robot guarda el texto en `tools/fuentes/`. Con esos archivos se pueden añadir sus lectores para que también se actualicen solas.
- **Robot pausado:** si el repositorio pasa 60 días sin ningún cambio, GitHub pausa el robot y te avisa por correo. Basta con volver a activarlo en la pestaña Actions.

Todo lo que hay aquí se publica gratis con GitHub y Cloudflare Pages. No hace falta servidor, base de datos ni cuenta de pago.

## Qué hay en la carpeta

| Archivo | Para qué sirve |
| --- | --- |
| `index.html` | La web completa (diseño, lógica y una copia de respaldo de los datos). |
| `data/*.json` | Los datos que lee la web. **Es lo único que tienes que tocar para actualizarla.** |
| `sw.js` | Permite usarla sin conexión y avisa cuando hay una versión nueva. |
| `manifest.webmanifest` e `icons/` | Hacen que se pueda instalar como app en iPhone y Android. |
| `assets/` | Logo e imagen de portada. |
| `_headers` | Le dice a Cloudflare que no guarde en caché los datos ni la web, para que los cambios lleguen al momento. |

## Publicarla (una sola vez)

1. Crea un repositorio en GitHub y sube el contenido de esta carpeta (no la carpeta en sí: `index.html` tiene que quedar en la raíz).
2. En Cloudflare, ve a **Workers & Pages → Create → Pages → Connect to Git** y elige el repositorio.
3. Deja vacíos el comando de build y la carpeta de salida (o pon `/`) y pulsa **Save and Deploy**.
4. Si quieres que sustituya a tu web actual, asigna el mismo dominio en **Custom domains**.

Cada vez que subas un cambio al repositorio, Cloudflare vuelve a publicar la web en uno o dos minutos.

## Cómo se actualiza sola

1. Editas cualquier archivo de `data/` (por ejemplo, añades un jugador a `players.json`).
2. **Cambias la fecha de `updated` en `data/meta.json`.** Es la señal que esperan las apps.
3. Subes los cambios a GitHub.

Todas las webs abiertas y apps instaladas comprueban `meta.json` al abrirse, al volver a ellas y cada 10 minutos. Si `updated` ha cambiado, descargan los datos nuevos, se repintan y muestran el aviso «Datos actualizados». No hace falta que nadie recargue nada.

Si cambias el diseño o el código (`index.html`), sube también el valor de `APP_VERSION` en `sw.js`. Así los usuarios con la app instalada verán el botón «Actualizar».

### Imágenes

Las imágenes de jugadores, entrenadores y noticias se leen de `CONFIG.IMG_BASE` (ahora `https://iecrossdatabase.pages.dev`), con las mismas rutas que usa tu web actual:

- `players/database/<id>.png`
- `coaches/small/<id>.png`
- `news/<archivo>.jpg`

Si mueves las imágenes a este mismo proyecto, cambia `IMG_BASE` a `''` al principio del script de `index.html`.

## Formato de los datos

### `players.json`
```json
{ "id": 2031, "name": "Torch", "alias": "", "team": "Caos", "pos": "FW", "el": "F",
  "stars": 3, "power": 10458, "isNew": true, "detail": { ... } }
```
- `pos`: `GK`, `DF`, `MF` o `FW`. `el`: `F` (Fuego), `V` (Viento), `B` (Bosque) o `M` (Montaña). También acepta los nombres en español.
- `alias`: nombre occidental u otros nombres por los que buscarlo.
- `detail` es opcional. Si falta, la ficha muestra un aviso en lugar de estadísticas. Mira el de Torch como plantilla: `tags`, `stats`, `speed`, `tp`, `zones`, `passives` y `techniques`.
- En una pasiva, `cond: { "type": "element", "el": "F", "min": 3 }` hace que el creador de formaciones compruebe si se cumple.

### `events.json`
Cada evento tiene `kind` (`gacha`, `evento`, `tienda` o `contenido`), `title`, `text`, `start` y `end` en hora de Japón (`2026-10-27T04:59:00+09:00`; `null` si es permanente), `img`, y opcionalmente `player` (id) o `team`.

### `tiers.json`
```json
{ "GK": { "updated": "2026-09-16", "tiers": { "S+": [1166], "S": [2044, 1170], "A": [], "B": [], "C": [], "D": [] } } }
```
Añade `DF`, `MF` y `FW` con la misma forma.

### `coaches.json`
Lista de entrenadores con su formación. Para que el creador compruebe requisitos y pasivas, añade `passive`, `formationPassive` y `conditions` como en Hibiki Seigou.

### `guides.json`: equipos recomendados y entrenamiento
```json
{
  "trials":   [ { "el": "V", "mode": "ataque", "rank": 1, "title": "...", "note": "...",
                  "lineup": [ { "id": 4009, "el": "B", "tech": "Nombre de la técnica", "manual": false } ] } ],
  "pvp":      [ { "tier": "SS", "version": "1.3.3", "coach": 71013, "title": "...", "note": "...",
                  "slots": [11 ids en el orden de las casillas, null si está vacía] } ],
  "limited":  [ { "group": "Grupo A", "title": "...", "text": "...", "lineup": [ ... ] } ],
  "crossSim": [ { "title": "Etapas 600 a 700", "text": "..." } ],
  "training": [ { "id": 2031, "picks": ["Efecto 1", "Efecto 2", "Efecto 3"], "note": "..." } ]
}
```
- `trials`: `mode` es `ataque` o `defensa`. Las cadenas, las ventajas de elemento y las diferencias con el primer puesto se calculan solas.
- Los equipos aparecen en Pruebas, Duelos, la Guía y en el apartado «En la práctica» de cada ficha. En cada ficha se indica también en cuántos equipos aparece el jugador.

## Modo editor

Abre `tu-web/#/editor` una vez en tu dispositivo (vuelve a abrirlo para desactivarlo). Aparecen dos botones nuevos:

- En **Pruebas**: «Copiar como recomendación». Monta el equipo en el planificador, pulsa el botón y pega el resultado en `guides.json` → `trials`. Rellena `title`, `note` y `tech`.
- En **Formación**: «Copiar como formación de duelos». Lo mismo para `guides.json` → `pvp`.

Los visitantes no ven estos botones.

## Instalarla en el iPhone

1. Abre la web en Safari.
2. Pulsa el botón Compartir.
3. Elige **Añadir a pantalla de inicio** y confirma con **Añadir**.

La web también muestra estas instrucciones sola a quien entra desde un iPhone, y están en Guía → Instalar la app.

## Rotación de las pruebas

Se calcula desde una fecha de referencia: `TRIAL_REF` (27 de septiembre de 2026, 04:00 JST = Montaña, ataque). Si el juego cambia el ciclo, ajusta `TRIAL_REF` y `TRIAL_ORDER` en `index.html`.

## Completar las fichas de todos los jugadores

`tools/importar-fichas.mjs` recorre las 122 fichas de la web original y guarda en `data/players.json` las estadísticas, zonas, etiquetas, pasivas y supertécnicas de cada jugador. Necesita Node 18 o superior y no hay que instalar nada más.

```bash
node tools/importar-fichas.mjs --solo 2031     # prueba con una ficha
node tools/importar-fichas.mjs                 # importa todas (tarda un par de minutos)
```

Al terminar actualiza `meta.json` solo. Sube los cambios y todas las apps se refrescarán.

Si alguna ficha falla, ejecuta `node tools/importar-fichas.mjs --depurar <id>` y guarda el texto que muestra; con él se ajusta el lector en un momento.

## Nombres

Cada jugador admite `name` (japonés romanizado), `nameEU` (europeo) y `nameJP` (japonés original). Desde el botón de ajustes, cada usuario elige cómo verlos: romanizado, europeo, japonés original o europeo con el japonés al lado. Si falta uno, se muestra el romanizado. El buscador encuentra a cada jugador por cualquiera de sus nombres. Los entrenadores admiten los mismos campos en `coaches.json`.

## Tu versión de cada jugador

En la colección y en cada ficha, el usuario puede indicar el despertar, el nivel del jugador y el nivel de cada técnica. Con eso la web calcula:

- qué pasivas tiene desbloqueadas y cuántos niveles o despertares le faltan,
- el poder de cada técnica a su nivel y cuánto le falta para el máximo,
- el poder de técnicas del equipo del planificador con sus niveles,
- un orden alternativo de los equipos recomendados según sus niveles.

Las pasivas se desbloquean leyendo el texto `unlock` de cada pasiva (`nivel 431`, `despertar 8`). El despertar máximo es `AWAKEN_MAX` y el nivel máximo `MAX_LEVEL` en `index.html`.

## Equipos y guías

Los equipos de pruebas, las formaciones de duelos, el entrenamiento recomendado, la batalla limitada, la Cross Simulator, las pruebas de club y las valoraciones están en `data/guides.json`. Los equipos de pruebas los actualiza el robot; el resto se edita en ese archivo.
