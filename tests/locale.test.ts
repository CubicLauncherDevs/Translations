import { expect, test } from 'bun:test';
import worker from '../src/index';
import fr from '../src/locales/fr-FR.json';

const base = 'https://i18n.example';

function fetchPath(path: string, headers?: HeadersInit) {
	return worker.fetch(new Request(base + path, { headers }), {} as never, {} as never);
}

// El ETag se deriva del JSON compacto (SHA-256, primeros 16 hex). Si este valor
// cambiara, los launchers con un ETag previo dejarían de recibir 304.
async function expectedEtag(locale: string, dict: unknown): Promise<string> {
	const bytes = new TextEncoder().encode(JSON.stringify(dict));
	const digest = await crypto.subtle.digest('SHA-256', bytes);
	const hash = Array.from(new Uint8Array(digest))
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('');
	return `W/"${locale}-${hash.slice(0, 16)}"`;
}

test('GET /{locale} mantiene un ETag estable y responde 304 si no cambia', async () => {
	const first = await fetchPath('/fr');
	expect(first.status).toBe(200);
	const etag = first.headers.get('ETag');
	expect(etag).toBe(await expectedEtag('fr', fr));
	expect(await first.json()).toEqual(fr);

	// Repetir la petición no cambia el ETag (payload cacheado).
	const second = await fetchPath('/fr');
	expect(second.headers.get('ETag')).toBe(etag);

	// Con If-None-Match el launcher recibe 304 y no re-descarga.
	const notModified = await fetchPath('/fr', { 'If-None-Match': etag! });
	expect(notModified.status).toBe(304);
	expect(notModified.headers.get('ETag')).toBe(etag);
	expect(await notModified.text()).toBe('');
});

test('If-None-Match tolera prefijos débiles, listas y comodín', async () => {
	const etag = (await fetchPath('/fr')).headers.get('ETag')!;
	for (const header of [etag, etag.replace('W/', ''), `"otro", ${etag}`, '*']) {
		const response = await fetchPath('/fr', { 'If-None-Match': header });
		expect(response.status).toBe(304);
	}

	// Un ETag distinto sí devuelve el diccionario completo.
	const miss = await fetchPath('/fr', { 'If-None-Match': 'W/"fr-deadbeef"' });
	expect(miss.status).toBe(200);
});

test('?flat=true devuelve el diccionario aplanado sin metadatos', async () => {
	const response = await fetchPath('/fr?flat=true');
	expect(response.status).toBe(200);

	const flat = await response.json();
	expect(flat.id).toBeUndefined();
	expect(flat.version).toBeUndefined();
	const values = Object.values(flat);
	expect(values.length).toBeGreaterThan(0);
	expect(values.every((value) => typeof value === 'string')).toBe(true);
});

test('las descargas conservan el archivo indentado con tabulaciones', async () => {
	const response = await fetchPath('/download/fr');
	expect(response.status).toBe(200);
	expect(response.headers.get('Content-Disposition')).toContain('filename="fr-FR.json"');
	expect(await response.text()).toBe(JSON.stringify(fr, null, '\t'));
});
