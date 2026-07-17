# CubicLauncher i18n Worker

Mini servidor de internacionalización para [CubicLauncher](https://github.com/CubicLauncherDevs/CubicLauncher) desplegado en **Cloudflare Workers**. Expone las traducciones actuales de la rama `develop` como una API JSON pública con soporte de fallback a inglés e interpolación de parámetros.

## Estructura del proyecto

```
.
├── src/
│   ├── index.ts          # Entrypoint del Worker y rutas
│   ├── i18n.ts           # Helpers: flatten, interpolate, fallback
│   └── locales/          # Archivos de traducción descargados (nombrados por su campo id)
│       ├── de-DE.json
│       ├── en-US.json
│       ├── es-ES.json
│       ├── fr-FR.json
│       └── uk-UA.json
├── tools/
│   └── fetch-locales.js  # Descarga las traducciones desde GitHub
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
| `npm run fetch-locales` | Descarga las últimas traducciones desde `develop` |

## Endpoints

### `GET /`
Información del servicio e idiomas disponibles.

### `GET /locales`
Lista los idiomas soportados con su short code y su `id` completo.

```json
[
  { "code": "es", "id": "es-ES", "label": "Español", "flag": "🇪🇸" },
  { "code": "en", "id": "en-US", "label": "English", "flag": "🇬🇧" }
]
```

### `GET /{locale}`
Devuelve el diccionario completo de un idioma en formato anidado. Acepta tanto el short code (`es`) como el `id` completo (`es-ES`).

```bash
curl https://<tu-worker>.workers.dev/es
curl https://<tu-worker>.workers.dev/es-ES
```

### `GET /{locale}?flat=true`
Devuelve el diccionario con las claves aplanadas, igual que usa el launcher internamente.

```bash
curl "https://<tu-worker>.workers.dev/en?flat=true"
curl "https://<tu-worker>.workers.dev/en-US?flat=true"
```

### `GET /{locale}.json`
Descarga el archivo JSON original del idioma usando el campo `id` como nombre de archivo. Acepta short code o `id` completo.

```bash
curl -OJ https://<tu-worker>.workers.dev/es.json
# Guarda "es-ES.json"

curl -OJ https://<tu-worker>.workers.dev/es-ES.json
# También guarda "es-ES.json"
```

### `GET /download/{locale}`
Alias para descargar el archivo JSON de un idioma.

```bash
curl -OJ https://<tu-worker>.workers.dev/download/es
# Guarda "es-ES.json"

curl -OJ https://<tu-worker>.workers.dev/download/es-ES
# También guarda "es-ES.json"
```

### `GET /{locale}/{dotted.key}`
Devuelve una traducción concreta. Soporta interpolación vía query params. Acepta short code o `id` completo.

```bash
# Sin interpolación
curl https://<tu-worker>.workers.dev/es/common.cancel
# { "value": "Cancelar", ... }

curl https://<tu-worker>.workers.dev/es-ES/common.cancel
# { "value": "Cancelar", ... }

# Con interpolación
curl "https://<tu-worker>.workers.dev/es/settings.java.installVersion?version=17"
# { "value": "Instalando Java 17...", "interpolated": true }
```

Si la clave no existe en el idioma solicitado, cae automáticamente al inglés.

### `GET /{locale}/nested/path/to/key`
Acceso a valores anidados sin usar puntos.

```bash
curl https://<tu-worker>.workers.dev/es/nested/settings/launcher/language
# { "value": "Idioma", "path": "settings.launcher.language" }
```

### `POST /sync`
Verifica que los archivos de traducción sigan disponibles en el repositorio upstream. Si configuras `SYNC_SECRET` en `wrangler.json` o en `dev.vars`, se requiere pasarlo como `?secret=...` o `Authorization: Bearer ...`.

## Actualizar traducciones

Para sincronizar los archivos JSON con la última versión de CubicLauncher:

```bash
npm run fetch-locales
npm run build
npm run deploy
```

## Configuración

Edita `wrangler.json` para cambiar la rama, el path o el repositorio fuente:

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
