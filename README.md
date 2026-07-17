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
  { "code": "fr", "id": "fr-FR", "label": "Français", "flag": "🇫🇷" },
  { "code": "de", "id": "de-DE", "label": "Deutsch", "flag": "🇩🇪" }
]
```

### `GET /{locale}`
Devuelve el diccionario completo de un idioma en formato anidado. Acepta tanto el short code (`fr`) como el `id` completo (`fr-FR`).

```bash
curl https://i18n.cubiclauncher.org/fr
curl https://i18n.cubiclauncher.org/fr-FR
```

### `GET /{locale}?flat=true`
Devuelve el diccionario con las claves aplanadas, igual que usa el launcher internamente.

```bash
curl "https://i18n.cubiclauncher.org/fr?flat=true"
curl "https://i18n.cubiclauncher.org/fr-FR?flat=true"
```

### `GET /{locale}.json`
Descarga el archivo JSON original del idioma usando el campo `id` como nombre de archivo. Acepta short code o `id` completo.

```bash
curl -OJ https://i18n.cubiclauncher.org/fr.json
# Guarda "fr-FR.json"

curl -OJ https://i18n.cubiclauncher.org/fr-FR.json
# También guarda "fr-FR.json"
```

### `GET /download/{locale}`
Alias para descargar el archivo JSON de un idioma.

```bash
curl -OJ https://i18n.cubiclauncher.org/download/fr
# Guarda "fr-FR.json"

curl -OJ https://i18n.cubiclauncher.org/download/fr-FR
# También guarda "fr-FR.json"
```

### `GET /{locale}/{dotted.key}`
Devuelve una traducción concreta. Soporta interpolación vía query params. Acepta short code o `id` completo.

```bash
# Sin interpolación
curl https://i18n.cubiclauncher.org/fr/common.cancel
# { "value": "Annuler", ... }

curl https://i18n.cubiclauncher.org/fr-FR/common.cancel
# { "value": "Annuler", ... }

# Con interpolación
curl "https://i18n.cubiclauncher.org/fr/settings.java.installVersion?version=17"
# { "value": "Installation de Java 17...", "interpolated": true }
```

Si la clave no existe en el idioma solicitado, cae automáticamente al francés.

### `GET /{locale}/nested/path/to/key`
Acceso a valores anidados sin usar puntos.

```bash
curl https://i18n.cubiclauncher.org/fr/nested/settings/launcher/language
# { "value": "Langue", "path": "settings.launcher.language" }
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
