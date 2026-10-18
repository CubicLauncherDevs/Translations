import { expect, spyOn, test } from 'bun:test';
import worker from '../src/index';

test('GET /locales exposes each locale translation progress against en-US', async () => {
	const response = await worker.fetch(new Request('https://i18n.example/locales'), {} as never, {} as never);
	expect(response.status).toBe(200);

	const locales: Array<{
		code: string;
		total: number;
		translated: number;
		missing: number;
		percentage: number;
	}> = await response.json();

	expect(locales.length).toBeGreaterThan(0);

	const en = locales.find((locale) => locale.code === 'en');
	expect(en).toBeDefined();
	expect(en!.percentage).toBe(100);

	for (const locale of locales) {
		expect(locale.total).toBeGreaterThan(0);
		expect(locale.percentage).toBeGreaterThanOrEqual(0);
		expect(locale.percentage).toBeLessThanOrEqual(100);
		expect(locale.translated).toBeGreaterThanOrEqual(0);
		expect(locale.missing).toBeGreaterThanOrEqual(0);
		expect(locale.translated + locale.missing).toBeLessThanOrEqual(locale.total);

		if (locale.code !== 'en') {
			expect(locale.percentage).toBeLessThanOrEqual(100);
			expect(locale.translated).toBeGreaterThan(0);
		}
	}
});

test('GET / includes the translation percentage for every locale', async () => {
	const github = spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ workflow_runs: [] }));

	try {
		const response = await worker.fetch(new Request('https://i18n.example/'), {} as never, {} as never);
		expect(response.status).toBe(200);

		const body = await response.json();
		expect(body.version).toBe('1.4.0');
		expect(Array.isArray(body.locales)).toBe(true);

		for (const locale of body.locales) {
			expect(typeof locale.code).toBe('string');
			expect(typeof locale.percentage).toBe('number');
			expect(locale.percentage).toBeGreaterThanOrEqual(0);
			expect(locale.percentage).toBeLessThanOrEqual(100);
		}

		expect(body.locales.find((locale: { code: string }) => locale.code === 'en').percentage).toBe(100);
	} finally {
		github.mockRestore();
	}
});
