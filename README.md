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
├── tsconfig.json
└── package.json
```

## Instalación

```bash
npm install
```

## Scripts

| Script | Descripción |
|--------|-------------|
| `npm run dev` | Levanta el Worker localmente con `wrangler dev` |
| `npm run deploy` | Despliega el Worker en Cloudflare |
| `npm run build` | Verifica tipos con TypeScript |
| `npm run fetch-locales` | Descarga las últimas traducciones desde GitHub |
| `npm run sync-locales` | Sincroniza archivos locales con la referencia en-US |

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

### `GET /locales`

Lista los idiomas soportados con su short code y su `id` completo.

```json
[
	{ "code": "fr", "id": "fr-FR", "label": "Français", "flag": "🇫🇷" },
	{ "code": "de", "id": "de-DE", "label": "Deutsch", "flag": "🇩🇪" }
]
```

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
npm run build
npm run deploy
```

> También puedes usar `npm run sync-locales` para rellenar claves faltantes de otros idiomas a partir del en-US local.

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
npm run deploy
```

Asegúrate de haber iniciado sesión con `wrangler login` previamente.
