import de from './locales/de-DE.json';
import en from './locales/en-US.json';
import es from './locales/es-ES.json';
import fr from './locales/fr-FR.json';
import uk from './locales/uk-UA.json';
import ja from './locales/ja-JP.json';

export type DictValue = string | { [key: string]: DictValue };
export type LocaleDict = Record<string, DictValue>;
export type FlatDict = Record<string, string>;

export const locales: Record<string, LocaleDict> = { en, es, fr, de, uk, ja };

export const localeIds: Record<string, string> = Object.fromEntries(
	Object.entries(locales).map(([code, dict]) => {
		const id = dict.id;
		return [code, typeof id === 'string' ? id : code];
	}),
);

export const idToLocale: Record<string, string> = Object.fromEntries(
	Object.entries(localeIds).map(([code, id]) => [id, code]),
);

export function resolveLocale(input: string): string | null {
	if (locales[input]) return input;
	const fromId = idToLocale[input];
	return fromId ?? null;
}

export const localeMeta = [
	{ code: 'en', label: 'English', flag: '🇬🇧' },
	{ code: 'es', label: 'Español', flag: '🇪🇸' },
	{ code: 'fr', label: 'Français', flag: '🇫🇷' },
	{ code: 'de', label: 'Deutsch', flag: '🇩🇪' },
	{ code: 'uk', label: 'Українська', flag: '🇺🇦' },
	{ code: 'ja', label: '日本語', flag: '🇯🇵' },
] as const;

let flatCache: Map<string, FlatDict> | null = null;

function ensureCache(): Map<string, FlatDict> {
	if (!flatCache) {
		flatCache = new Map();
	}
	return flatCache;
}

export function flatten(obj: LocaleDict, prefix = ''): FlatDict {
	const result: FlatDict = {};
	for (const key in obj) {
		// `id` y `version` son metadatos, no claves de traducción.
		if (key === 'id' || key === 'version') continue;
		const val = obj[key];
		if (typeof val === 'string') {
			result[prefix + key] = val;
		} else if (val && typeof val === 'object') {
			Object.assign(result, flatten(val, prefix + key + '.'));
		}
	}
	return result;
}

export function getFlat(locale: string): FlatDict {
	const cache = ensureCache();
	let cached = cache.get(locale);
	if (!cached) {
		const dict = locales[locale];
		cached = dict ? flatten(dict) : {};
		cache.set(locale, cached);
	}
	return cached;
}

export function interpolate(text: string, params: Record<string, string>): string {
	return text.replace(/\{(\w+)\}/g, (_, name) => params[name] ?? `{${name}}`);
}

export function getNestedValue(dict: LocaleDict, path: string[]): DictValue | undefined {
	let current: DictValue | undefined = dict;
	for (const segment of path) {
		if (current === undefined || typeof current === 'string') return undefined;
		current = current[segment];
	}
	return current;
}

export function getLocale(code: string): LocaleDict | undefined {
	return locales[code];
}

export function getLocaleVersion(dict: LocaleDict): string | undefined {
	return typeof dict.version === 'string' ? dict.version : undefined;
}

export async function computeLocaleEtag(locale: string, dict: LocaleDict): Promise<string> {
	const text = JSON.stringify(dict);
	const bytes = new TextEncoder().encode(text);
	const buffer = await crypto.subtle.digest('SHA-256', bytes);
	const hash = Array.from(new Uint8Array(buffer))
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('');
	return `W/"${locale}-${hash.slice(0, 16)}"`;
}

export function resolveTranslation(
	locale: string,
	key: string,
	params: Record<string, string>,
): { value: string; localeUsed: string; interpolated: boolean } | null {
	const flat = getFlat(locale);
	const text = flat[key];

	if (text === undefined) return null;

	const interpolated = Object.keys(params).length > 0;
	return {
		value: interpolated ? interpolate(text, params) : text,
		localeUsed: localeIds[locale],
		interpolated,
	};
}
