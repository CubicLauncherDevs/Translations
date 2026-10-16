import changelog from './changelog.json';
import { getLastSync } from './last-sync.js';
import {
	getLocalePayload,
	getLocaleProgress,
	getLocaleVersion,
	getNestedValue,
	localeIds,
	localeMeta,
	locales,
	resolveLocale,
	resolveTranslation,
	type DictValue,
	type LocaleDict,
} from './i18n.js';

interface Env {
	LOCALE_REPO_OWNER: string;
	LOCALE_REPO_NAME: string;
	LOCALE_REPO_BRANCH: string;
	LOCALE_REPO_PATH: string;
	SYNC_SECRET?: string;
}

const corsHeaders = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
	'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function serializedJsonResponse(body: string, status = 200, extraHeaders: Record<string, string> = {}) {
	return new Response(body, {
		status,
		headers: {
			'Content-Type': 'application/json',
			'Cache-Control': 'public, max-age=60',
			...corsHeaders,
			...extraHeaders,
		},
	});
}

function jsonResponse(data: unknown, status = 200, extraHeaders: Record<string, string> = {}) {
	return serializedJsonResponse(JSON.stringify(data, null, 2), status, extraHeaders);
}

function errorResponse(message: string, status = 400) {
	return jsonResponse({ error: message }, status);
}

function notModifiedResponse(etag: string) {
	return new Response(null, {
		status: 304,
		headers: {
			ETag: etag,
			'Cache-Control': 'public, max-age=60',
			...corsHeaders,
		},
	});
}

// Compara `If-None-Match` con el ETag actual tolerando listas, `*` y prefijos
// débiles (`W/`). Así un launcher que ya tiene el recurso recibe 304 y evita
// volver a descargar el diccionario completo.
function etagMatches(header: string | null, etag: string): boolean {
	if (!header) return false;

	const normalize = (value: string) => value.trim().replace(/^W\//, '');
	const candidates = header.split(',');
	if (candidates.some((candidate) => candidate.trim() === '*')) return true;

	const target = normalize(etag);
	return candidates.some((candidate) => normalize(candidate) === target);
}

function serializeDictValue(value: DictValue | undefined): unknown {
	if (value === undefined) return null;
	if (typeof value === 'string') return value;
	return value as LocaleDict;
}

async function downloadResponse(locale: string): Promise<Response> {
	const payloadPromise = getLocalePayload(locale);
	if (!payloadPromise) {
		return errorResponse(`Locale '${locale}' not found`, 404);
	}
	const payload = await payloadPromise;
	const filename = `${localeIds[locale] ?? locale}.json`;
	return new Response(payload.prettyTabs, {
		status: 200,
		headers: {
			'Content-Type': 'application/json; charset=utf-8',
			'Content-Disposition': `attachment; filename="${filename}"`,
			'Cache-Control': 'public, max-age=60',
			ETag: payload.etag,
			'X-Locale-Version': getLocaleVersion(locales[locale]) ?? 'unknown',
			...corsHeaders,
		},
	});
}

async function handleGetLocale(request: Request, locale: string): Promise<Response> {
	const payloadPromise = getLocalePayload(locale);
	if (!payloadPromise) {
		return errorResponse(`Locale '${locale}' not found`, 404);
	}
	const payload = await payloadPromise;

	const clientEtag = request.headers.get('If-None-Match');
	if (etagMatches(clientEtag, payload.etag)) {
		return notModifiedResponse(payload.etag);
	}

	const url = new URL(request.url);
	const flatRequested = url.searchParams.get('flat') === 'true';

	return serializedJsonResponse(flatRequested ? payload.flatPretty : payload.pretty, 200, {
		ETag: payload.etag,
		'X-Locale-Version': getLocaleVersion(locales[locale]) ?? 'unknown',
	});
}

function handleGetLocaleVersion(locale: string): Response {
	const dict = locales[locale];
	if (!dict) {
		return errorResponse(`Locale '${locale}' not found`, 404);
	}

	return jsonResponse({
		code: locale,
		id: localeIds[locale],
		version: getLocaleVersion(dict) ?? 'unknown',
	});
}

async function handleSync(request: Request, env: Env): Promise<Response> {
	const url = new URL(request.url);
	const secret = url.searchParams.get('secret') ?? request.headers.get('Authorization')?.replace('Bearer ', '');

	if (env.SYNC_SECRET && secret !== env.SYNC_SECRET) {
		return errorResponse('Unauthorized', 401);
	}

	const owner = env.LOCALE_REPO_OWNER;
	const repo = env.LOCALE_REPO_NAME;
	const branch = env.LOCALE_REPO_BRANCH;
	const path = env.LOCALE_REPO_PATH;

	const results: Record<string, { ok: boolean; status?: number; error?: string }> = {};

	await Promise.all(
		localeMeta.map(async ({ code }) => {
			const upstreamUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${path}/${code}.json`;
			try {
				const res = await fetch(upstreamUrl);
				if (!res.ok) {
					results[code] = { ok: false, status: res.status };
					return;
				}
				const body = await res.text();
				JSON.parse(body);
				results[code] = { ok: true, status: res.status };
			} catch (error) {
				results[code] = { ok: false, error: String(error) };
			}
		}),
	);

	return jsonResponse({ synced: results });
}

function handleGetChanges(url: URL): Response {
	const since = url.searchParams.get('since');
	const sinceMs = since ? new Date(since).getTime() : 0;

	const filtered = changelog.filter((entry) => {
		if (!since) return true;
		return new Date(entry.timestamp).getTime() >= sinceMs;
	});

	return jsonResponse({ changes: filtered });
}

export default {
	async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
		const url = new URL(request.url);
		const pathname = url.pathname.replace(/\/+$/, '') || '/';
		const parts = pathname.split('/').filter(Boolean);
		const method = request.method.toUpperCase();

		if (method === 'OPTIONS') {
			return new Response(null, { headers: corsHeaders });
		}

		// POST /sync - validate upstream locale availability
		if (method === 'POST' && parts[0] === 'sync') {
			return handleSync(request, env);
		}

		if (method !== 'GET') {
			return errorResponse('Method not allowed', 405);
		}

		// GET /
		if (parts.length === 0) {
			return jsonResponse({
				service: 'CubicLauncher i18n API',
				version: '1.4.0',
				lastSync: await getLastSync(),
				locales: localeMeta.map(({ code, label, flag }) => ({
					code,
					label,
					flag,
					percentage: getLocaleProgress(code).percentage,
				})),
				localeAlias: 'Endpoints accept both short code and full locale id',
				endpoints: {
					listLocales: '/locales',
					getLocale: '/{locale}',
					getLocaleFlat: '/{locale}?flat=true',
					getLocaleVersion: '/{locale}/version',
					getLocaleFile: '/{locale}.json',
					downloadLocale: '/download/{locale}',
					getChanges: '/locales/changes?since=<ISO8601>',
					getKey: '/{locale}/{dotted.key}',
					getKeyInterpolated: '/{locale}/{dotted.key}?param=value',
					getNested: '/{locale}/nested/path/to/key',
					sync: 'POST /sync?secret=...',
				},
			});
		}

		// GET /{locale}.json - download raw locale file
		if (parts.length === 1 && parts[0].endsWith('.json')) {
			const requested = parts[0].slice(0, -5);
			const resolved = resolveLocale(requested);
			if (resolved) {
				return downloadResponse(resolved);
			}
		}

		// GET /download/{locale}
		if (parts.length === 2 && parts[0] === 'download') {
			const resolved = resolveLocale(parts[1]);
			if (resolved) {
				return downloadResponse(resolved);
			}
		}

		// GET /locales/changes
		if (parts[0] === 'locales' && parts[1] === 'changes') {
			return handleGetChanges(url);
		}

		// GET /locales
		if (parts[0] === 'locales') {
			return jsonResponse(
				localeMeta.map(({ code, label, flag }) => ({
					code,
					id: localeIds[code],
					label,
					flag,
					...getLocaleProgress(code),
				})),
			);
		}

		const requestedLocale = parts[0];
		const locale = resolveLocale(requestedLocale);
		const dict = locale ? locales[locale] : undefined;
		if (!locale || !dict) {
			return errorResponse(`Locale '${requestedLocale}' not found`, 404);
		}

		// GET /{locale}/version
		if (parts.length === 2 && parts[1] === 'version') {
			return handleGetLocaleVersion(locale);
		}

		// GET /{locale}
		if (parts.length === 1) {
			return handleGetLocale(request, locale);
		}

		// GET /{locale}/nested/path/to/key
		if (parts[1] === 'nested' && parts.length > 2) {
			const path = parts.slice(2);
			const value = getNestedValue(dict, path);
			if (value === undefined) {
				return errorResponse(`Key '${path.join('.')}' not found`, 404);
			}
			return jsonResponse({
				value: serializeDictValue(value),
				locale: localeIds[locale],
				path: path.join('.'),
			});
		}

		// GET /{locale}/{dotted.key}
		const key = parts.slice(1).join('/');

		// Collect interpolation params from query string, excluding reserved words
		const params: Record<string, string> = {};
		url.searchParams.forEach((value, name) => {
			if (name !== 'flat') {
				params[name] = value;
			}
		});

		const result = resolveTranslation(locale, key, params);
		if (!result) {
			return errorResponse(`Key '${key}' not found`, 404);
		}

		return jsonResponse({
			value: result.value,
			key,
			locale,
			localeUsed: result.localeUsed,
			interpolated: result.interpolated,
		});
	},
};
