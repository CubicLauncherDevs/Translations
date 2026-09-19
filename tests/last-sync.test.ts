import { expect, spyOn, test } from 'bun:test';
import worker from '../src/index';

test('GET / exposes the latest successful sync, caches requests and tolerates GitHub failures', async () => {
	let now = Date.now();
	const clock = spyOn(Date, 'now').mockImplementation(() => now);
	const github = spyOn(globalThis, 'fetch');
	const errors = spyOn(console, 'error').mockImplementation(() => {});
	const run = {
		updated_at: '2026-09-19T04:03:58Z',
		status: 'completed',
		conclusion: 'success',
		html_url: 'https://github.com/CubicLauncherDevs/Translations/actions/runs/35420276838',
	};
	const expected = { timestamp: run.updated_at, status: 'success', url: run.html_url };
	const expire = () => { now += 5 * 60 * 1000 + 1; };
	const homepage = async () => {
		const response = await worker.fetch(new Request('https://i18n.example/'), {} as never, {} as never);
		expect(response.status).toBe(200);
		const body = await response.json();
		expect(body.service).toBe('CubicLauncher i18n API');
		expect(body.locales.length).toBeGreaterThan(0);
		return body;
	};

	try {
		// An initial outage must not break the homepage or cause repeated requests.
		github.mockResolvedValue(new Response(null, { status: 503 }));
		expect((await homepage()).lastSync).toBeNull();
		await homepage();
		expect(github).toHaveBeenCalledTimes(1);

		expire();
		github.mockImplementation(async () => Response.json({ workflow_runs: [] }));
		expect((await homepage()).lastSync).toBeNull();
		await homepage();
		expect(github).toHaveBeenCalledTimes(2);

		expire();
		github.mockImplementation(async () => Response.json({ workflow_runs: [run] }));
		const concurrent = await Promise.all([homepage(), homepage()]);
		for (const body of concurrent) expect(body.lastSync).toEqual(expected);
		expect(github).toHaveBeenCalledTimes(3);
		const [url, options] = github.mock.calls[2];
		expect(String(url)).toContain('Translations/actions/workflows/sync-locales.yml/runs?status=success&per_page=1');
		expect(options?.headers).toHaveProperty('User-Agent', 'CubicLauncher-i18n-Worker');
		expect(options?.signal).toBeInstanceOf(AbortSignal);
		expect((await homepage()).lastSync).toEqual(expected);
		expect(github).toHaveBeenCalledTimes(3);

		// Refresh after five minutes, without a deployment.
		expire();
		const newer = { ...run, updated_at: '2026-09-21T06:00:10Z', html_url: `${run.html_url}1` };
		github.mockImplementation(async () => Response.json({ workflow_runs: [newer] }));
		const latest = { ...expected, timestamp: newer.updated_at, url: newer.html_url };
		expect((await homepage()).lastSync).toEqual(latest);

		// Rate limits, malformed responses and timeouts preserve the last known sync.
		for (const result of [
			new Response(null, { status: 403 }),
			Response.json({ unexpected: true }),
			Response.json({ workflow_runs: [{ ...run, conclusion: 'failure' }] }),
			new DOMException('Request timed out', 'TimeoutError'),
		]) {
			expire();
			github.mockImplementation(async () => {
				if (result instanceof Error) throw result;
				return result;
			});
			expect((await homepage()).lastSync).toEqual(latest);
			const calls = github.mock.calls.length;
			expect((await homepage()).lastSync).toEqual(latest);
			expect(github).toHaveBeenCalledTimes(calls);
		}
		expect(errors).toHaveBeenCalledTimes(5);
	} finally {
		clock.mockRestore();
		github.mockRestore();
		errors.mockRestore();
	}
});
