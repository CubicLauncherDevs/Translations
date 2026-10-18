# CubicLauncher i18n Worker

Mini servidor de internacionalización para [CubicLauncher](https://github.com/CubicLauncherDevs/CubicLauncher) desplegado en **Cloudflare Workers**. Expone las traducciones como archivos JSON embebidos, con soporte de fallback a inglés, interpolación de parámetros, versionado y notificaciones de cambio estáticas.

> Este Worker **no usa KV ni depende de un repositorio upstream**. Los idiomas viven como archivos JSON en `src/locales/` y se actualizan modificando esos archivos y redeployando.

## Estructura del proyecto

```
.
├── src/
│   ├── index.ts          # Entrypoint del Worker y rutas
│   ├── i18n.ts           # Helpers: flatten, interpolate, fallback
│   ├── changelog.json    # Eventos de cambio de idiomas (manual)
│   └── locales/          # Archivos de traducción embebidos
│       ├── de-DE.json
│       ├── en-US.json
│       ├── es-ES.json
│       ├── fr-FR.json
│       ├── ja-JP.json
│       └── uk-UA.json
├── tools/
│   ├── fetch-locales.js  # Descarga traducciones desde GitHub (opcional)
│   └── sync-locales.js   # Sincroniza claves faltantes con en-US (local)
├── wrangler.json         # Configuración de Cloudflare Workers
├── flake.nix             # Dev shell reproducible con Nix (bun, node)
├── tsconfig.json
└── package.json
```

## Instalación

```bash
bun install
```

## Scripts

| Script | Descripción |
|--------|-------------|
| `bun run dev` | Levanta el Worker localmente con `wrangler dev` |
| `bun run deploy` | Despliega el Worker en Cloudflare |
| `bun run build` | Verifica tipos con TypeScript |
| `bun run fetch-locales` | Descarga las últimas traducciones desde GitHub |
| `bun run sync-locales` | Sincroniza archivos locales con la referencia en-US |

### Desarrollo con Nix

El repositorio incluye un `flake.nix` con un dev shell que trae `bun`, `nodejs` y
`git`. Con flakes habilitados:

```bash
nix develop        # entra al shell con bun y node disponibles
bun install
bun run dev
```

#### `workerd` en NixOS

El runtime `workerd` que usa Wrangler es un binario enlazado dinámicamente para
glibc genérico y, si tu NixOS no tiene `programs.nix-ld` habilitado,
`/lib64/ld-linux-x86-64.so.2` apunta al `stub-ld` y el arranque falla con
`Could not start dynamically linked executable`.

Habilita nix-ld en `configuration.nix` y reconstruye:

```nix
programs.nix-ld.enable = true;
programs.nix-ld.libraries = with pkgs; [
  glibc
  stdenv.cc.cc.lib
];
```

```bash
sudo nixos-rebuild switch --flake /etc/nixos#nixos
```

Tras reconstruir, `bun run dev` funciona sin configuración extra.

## Versionado de idiomas

Cada archivo `src/locales/*.json` debe llevar un campo `version` en la raíz:

```json
{
	"id": "es-ES",
	"version": "1.0.0",
	"common": { ... }
}
```

Cuando modifiques un idioma, incrementa su `version` (por ejemplo `1.0.1`, `1.1.0`, etc.) y añade una entrada en `src/changelog.json` para que los launchers se enteren del cambio.

## Endpoints

### `GET /`

Información del servicio, idiomas disponibles y endpoints.

Incluye `lastSync` con la última ejecución exitosa del workflow **Sync locales** de
[CubicLauncherDevs/Translations](https://github.com/CubicLauncherDevs/Translations):

```json
{
	"timestamp": "2026-09-19T04:03:58Z",
	"status": "success",
	"url": "https://github.com/CubicLauncherDevs/Translations/actions/runs/35420276838"
}
```

`timestamp` corresponde a la última actualización de la ejecución completada en
GitHub (ISO 8601, UTC). Este dato se consulta automáticamente, sin redesplegar la
API, y puede ser más reciente que las traducciones servidas por el Worker.

La consulta a GitHub tiene un límite de 3 segundos y una caché de 5 minutos por
instancia del Worker (además de los 60 segundos de caché HTTP de la respuesta).
Si GitHub falla, se conserva el último dato disponible en esa instancia.
`lastSync` es `null` si no hay ejecuciones exitosas o si la consulta falla sin
datos previos. La portada sigue respondiendo normalmente en ambos casos.

### `GET /locales`

Lista los idiomas soportados con su short code, su `id` completo y su nivel de
traducción.

```json
[
	{
		"code": "fr",
		"id": "fr-FR",
		"label": "Français",
		"flag": "🇫🇷",
		"total": 1136,
		"translated": 881,
		"missing": 0,
		"percentage": 77.6
	},
	{ "code": "de", "id": "de-DE", "label": "Deutsch", "flag": "🇩🇪", "total": 1136, "translated": 868, "missing": 0, "percentage": 76.4 }
]
```

#### Nivel de traducción

`percentage` (0–100, un decimal) se calcula comparando cada idioma con `en-US`,
que es la referencia y siempre marca `100`:

- `total`: número de claves en `en-US`.
- `translated`: claves presentes en el idioma cuyo valor **difiere** del inglés,
  más las claves marcadas como idénticas permitidas (ver abajo).
- `missing`: claves de `en-US` ausentes en el idioma.

Una clave cuyo texto sigue siendo idéntico al inglés se considera **no
traducida**, ya que el script `sync-locales` rellena las claves faltantes
copiando el valor de `en-US`. Sin embargo, hay claves que de forma intencionada
mantienen el inglés en un idioma: nombres propios, marcas, URLs, formatos de
placeholder y términos que la comunidad usa tal cual (por ejemplo `Minecraft`,
`Modrinth`, `Azul Zulu` o `Mods`). Esas claves se declaran en
`identicalKeysByLocale` dentro de `src/i18n.ts` y cuentan como traducidas, de
modo que un idioma con todo el texto traducido alcanza el `100%` sin tener que
falsear esas cadenas. La portada (`GET /`) incluye el `percentage` de cada
idioma junto a `code`, `label` y `flag`.

### `GET /{locale}`

Devuelve el diccionario completo de un idioma. Acepta short code (`fr`) o `id` completo (`fr-FR`).

```bash
curl https://i18n.cubiclauncher.org/fr
curl https://i18n.cubiclauncher.org/fr-FR
```

Respuesta con cabeceras de versión:

```http
ETag: W/"fr-abc123..."
X-Locale-Version: 1.0.0
```

### `GET /{locale}?flat=true`

Devuelve el diccionario con las claves aplanadas, ignorando `id` y `version`.

```bash
curl "https://i18n.cubiclauncher.org/fr?flat=true"
```

### `GET /{locale}/version`

Devuelve solo el código, `id` y `version` del idioma. Útil para chequeos rápidos del launcher.

```bash
curl https://i18n.cubiclauncher.org/fr/version
```

```json
{ "code": "fr", "id": "fr-FR", "version": "1.0.0" }
```

### `GET /{locale}.json` y `GET /download/{locale}`

Descarga el archivo JSON original del idioma. El nombre usa el campo `id`.

```bash
curl -OJ https://i18n.cubiclauncher.org/fr.json
curl -OJ https://i18n.cubiclauncher.org/download/fr
```

### `GET /{locale}/{dotted.key}`

Devuelve una traducción concreta. Soporta interpolación vía query params.

```bash
# Sin interpolación
curl https://i18n.cubiclauncher.org/fr/common.cancel

# Con interpolación
curl "https://i18n.cubiclauncher.org/fr/settings.java.installVersion?version=17"
```

### `GET /{locale}/nested/path/to/key`

Acceso a valores anidados sin usar puntos.

```bash
curl https://i18n.cubiclauncher.org/fr/nested/settings/launcher/language
```

### `GET /locales/changes?since=<ISO8601>`

Devuelve los eventos del changelog ocurridos desde el timestamp indicado.

```bash
curl "https://i18n.cubiclauncher.org/locales/changes?since=2026-07-26T00:00:00Z"
```

```json
{
	"changes": [
		{
			"type": "locale.updated",
			"locale": "es-ES",
			"version": "1.1.0",
			"timestamp": "2026-07-26T18:30:00.000Z",
			"details": { "note": "Updated common translations" }
		}
	]
}
```

### `POST /sync`

Valida que los archivos de traducción sigan disponibles en el repositorio configurado. No actualiza nada en el Worker; solo comprueba que las URLs upstream respondan.

Si configuras `SYNC_SECRET` en `wrangler.json` o `.dev.vars`, se requiere pasarlo como `?secret=...` o `Authorization: Bearer ...`.

## `src/changelog.json`

Archivo estático con eventos de cambio. El launcher puede consultarlo para saber qué idiomas revisar.

```json
[
	{
		"type": "locale.updated",
		"locale": "es-ES",
		"version": "1.1.0",
		"timestamp": "2026-07-26T18:30:00.000Z",
		"details": { "note": "Updated common translations" }
	},
	{
		"type": "locale.added",
		"locale": "pt-BR",
		"version": "1.0.0",
		"timestamp": "2026-07-27T10:00:00.000Z",
		"details": { "note": "Added Portuguese locale" }
	}
]
```

Tipos de eventos soportados:

- `locale.added`
- `locale.updated`
- `locale.removed`
- `locale.error`

## Flujo recomendado para el launcher

1. **Carga inicial**: `GET /{locale}` descarga el JSON completo.
2. **Chequeo periódico**: cada cierto tiempo envía la última versión conocida:
   ```bash
   curl -H 'If-None-Match: W/"fr-abc123..."' https://i18n.cubiclauncher.org/fr
   ```
3. Si el Worker responde `304 Not Modified`, no hay nada nuevo.
4. Si responde `200`, compara el JSON contra el que ya tiene y aplica solo las diferencias.
5. También puede consultar `GET /locales/changes?since=<últimaConsulta>` para saber qué idiomas revisar sin tener que preguntar por cada uno.

## Actualizar traducciones

1. Edita los archivos `src/locales/*.json`.
2. Incrementa el campo `version` de cada idioma modificado.
3. Añade las entradas correspondientes a `src/changelog.json`.
4. Construye y despliega:

```bash
bun run build
bun run deploy
```

> También puedes usar `bun run sync-locales` para rellenar claves faltantes de otros idiomas a partir del en-US local.

### Releases automáticas de sincronización

El workflow `.github/workflows/sync-locales.yml` se ejecuta cada lunes a las
06:00 UTC y también puede iniciarse desde **Actions → Sync locales → Run workflow**.
Sincroniza las traducciones con Bun, sube los cambios si los hay y publica una
Release mediante `softprops/action-gh-release`.

Cada ejecución exitosa publica una Release, incluso si no cambió ningún archivo:

- Etiqueta única `sync-<run_id>` y título `Translations sync #<run_number>`.
- La etiqueta apunta al commit resultante de la sincronización.
- Todos los archivos `src/locales/*.json` se adjuntan individualmente.
- La descripción incluye la fecha de publicación UTC, el commit y el enlace a la ejecución.

Si falla la sincronización o la subida del commit, no se publica la Release.
Al reintentar una ejecución cuya etiqueta ya existe, se recuperan las traducciones
de esa etiqueta y se actualiza la misma Release con sus archivos, sin duplicarla.
Se utiliza el `GITHUB_TOKEN` automático con permiso `contents: write`.

## Configuración

Edita `wrangler.json` para cambiar la rama, el path o el repositorio fuente (solo usado por `POST /sync`):

```json
{
	"vars": {
		"LOCALE_REPO_OWNER": "CubicLauncherDevs",
		"LOCALE_REPO_NAME": "CubicLauncher",
		"LOCALE_REPO_BRANCH": "develop",
		"LOCALE_REPO_PATH": "src/lib/i18n"
	}
}
```

Para añadir un secreto local de sincronización:

```bash
echo "SYNC_SECRET=tu-secreto" > .dev.vars
```

## Despliegue

```bash
bun run deploy
```

Asegúrate de haber iniciado sesión con `wrangler login` previamente.
