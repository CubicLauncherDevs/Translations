import {
	defaultLocale,
	flatten,
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

function jsonResponse(data: unknown, status = 200, extraHeaders: Record<string, string> = {}) {
	return new Response(JSON.stringify(data, null, 2), {
		status,
		headers: {
			'Content-Type': 'application/json',
			'Cache-Control': 'public, max-age=60',
			...corsHeaders,
			...extraHeaders,
		},
	});
}

function errorResponse(message: string, status = 400) {
	return jsonResponse({ error: message }, status);
}

function serializeDictValue(value: DictValue | undefined): unknown {
	if (value === undefined) return null;
	if (typeof value === 'string') return value;
	return value as LocaleDict;
}

function downloadResponse(locale: string): Response {
	const dict = locales[locale];
	if (!dict) {
		return errorResponse(`Locale '${locale}' not found`, 404);
	}
	const filename = `${localeIds[locale] ?? locale}.json`;
	return new Response(JSON.stringify(dict, null, '\t'), {
		status: 200,
		headers: {
			'Content-Type': 'application/json; charset=utf-8',
			'Content-Disposition': `attachment; filename="${filename}"`,
			'Cache-Control': 'public, max-age=60',
			...corsHeaders,
		},
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
			const url = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${path}/${code}.json`;
			try {
				const res = await fetch(url);
				if (!res.ok) {
					results[code] = { ok: false, status: res.status };
					return;
				}
				// Real deployments would write to KV/R2 here.
				// For the embedded version this endpoint only validates reachability.
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
				version: '1.0.0',
				defaultLocale,
				locales: localeMeta,
				localeAlias: 'Endpoints accept both short code (es) and full id (es-ES)',
				endpoints: {
					listLocales: '/locales',
					getLocale: '/{locale}',
					getLocaleFlat: '/{locale}?flat=true',
					getLocaleFile: '/{locale}.json',
					downloadLocale: '/download/{locale}',
					getKey: '/{locale}/{dotted.key}',
					getKeyInterpolated: '/{locale}/{dotted.key}?param=value',
					getNested: '/{locale}/nested/path/to/key',
					sync: 'POST /sync?secret=...',
				},
			});
		}

		// GET /{locale}.json - download raw locale file (accepts both short code and id)
		if (parts.length === 1 && parts[0].endsWith('.json')) {
			const requested = parts[0].slice(0, -5);
			const resolved = resolveLocale(requested);
			if (resolved) {
				return downloadResponse(resolved);
			}
		}

		// GET /download/{locale} - alternative download endpoint (accepts both short code and id)
		if (parts.length === 2 && parts[0] === 'download') {
			const resolved = resolveLocale(parts[1]);
			if (resolved) {
				return downloadResponse(resolved);
			}
		}

		// GET /locales
		if (parts[0] === 'locales') {
			return jsonResponse(
				localeMeta.map(({ code, label, flag }) => ({
					code,
					id: localeIds[code],
					label,
					flag,
				})),
			);
		}

		const requestedLocale = parts[0];
		const locale = resolveLocale(requestedLocale);
		const dict = locale ? locales[locale] : undefined;
		if (!locale || !dict) {
			return errorResponse(`Locale '${requestedLocale}' not found`, 404);
		}

		// GET /{locale}
		if (parts.length === 1) {
			const flatRequested = url.searchParams.get('flat') === 'true';
			if (flatRequested) {
				return jsonResponse(flatten(dict));
			}
			return jsonResponse(dict);
		}

		// GET /{locale}/nested/path/to/key
		if (parts[1] === 'nested' && parts.length > 2) {
			const path = parts.slice(2);
			const value = getNestedValue(dict, path);
			if (value === undefined && locale !== defaultLocale) {
				const fallback = getNestedValue(locales[defaultLocale], path);
				if (fallback !== undefined) {
					return jsonResponse({
						value: serializeDictValue(fallback),
						locale: defaultLocale,
						path: path.join('.'),
					});
				}
			}
			if (value === undefined) {
				return errorResponse(`Key '${path.join('.')}' not found`, 404);
			}
			return jsonResponse({
				value: serializeDictValue(value),
				locale,
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
