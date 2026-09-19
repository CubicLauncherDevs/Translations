const WORKFLOW_RUNS_URL =
	'https://api.github.com/repos/CubicLauncherDevs/Translations/actions/workflows/sync-locales.yml/runs?status=success&per_page=1';
const CACHE_TTL_MS = 5 * 60 * 1000;

interface LastSync {
	timestamp: string;
	status: 'success';
	url: string;
}

interface WorkflowRun {
	updated_at: string;
	conclusion: string;
	status: string;
	html_url: string;
}

let cachedSync: LastSync | null = null;
let refreshAfter = 0;
let pending: Promise<LastSync | null> | undefined;

async function refreshLastSync(): Promise<LastSync | null> {
	try {
		const response = await fetch(WORKFLOW_RUNS_URL, {
			headers: {
				Accept: 'application/vnd.github+json',
				'User-Agent': 'CubicLauncher-i18n-Worker',
				'X-GitHub-Api-Version': '2022-11-28',
			},
			signal: AbortSignal.timeout(3000),
		});
		if (!response.ok) {
			throw new Error(`GitHub workflow request failed: ${response.status}`);
		}

		const data = await response.json<{ workflow_runs: WorkflowRun[] }>();
		if (!Array.isArray(data.workflow_runs)) {
			throw new Error('Invalid GitHub workflow response');
		}
		const run = data.workflow_runs[0];
		if (run) {
			if (
				run.status !== 'completed' || run.conclusion !== 'success' ||
				!Number.isFinite(Date.parse(run.updated_at)) || typeof run.html_url !== 'string'
			) {
				throw new Error('Invalid GitHub workflow run');
			}
			cachedSync = { timestamp: run.updated_at, status: 'success', url: run.html_url };
		} else {
			cachedSync = null;
		}
	} catch (error) {
		console.error('Unable to refresh last synchronization:', error);
	}

	// Cache empty results and failures too, to avoid repeatedly hitting GitHub.
	refreshAfter = Date.now() + CACHE_TTL_MS;
	return cachedSync;
}

export function getLastSync(): Promise<LastSync | null> {
	if (Date.now() < refreshAfter) return Promise.resolve(cachedSync);
	if (!pending) {
		pending = refreshLastSync().finally(() => { pending = undefined; });
	}
	return pending;
}
