import { writeFile, readFile, mkdir, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOCALES_DIR = join(__dirname, '..', 'src', 'locales');

const OWNER = 'CubicLauncherDevs';
const REPO = 'CubicLauncher';
const REPO_PATH = 'src/lib/i18n';

async function fetchReference() {
	const url = `https://raw.githubusercontent.com/${OWNER}/${REPO}/develop/${REPO_PATH}/en-US.json`;
	console.log('Downloading en-US.json (reference)...');

	const response = await fetch(url);
	if (!response.ok) {
		throw new Error(`Failed to download en-US.json: ${response.status}`);
	}

	return JSON.parse(await response.text());
}

function mergeMissingKeys(reference, target) {
	const result = { ...target };

	for (const key of Object.keys(reference)) {
		if (key === 'id') continue;

		if (!(key in target)) {
			result[key] = JSON.parse(JSON.stringify(reference[key]));
		} else if (
			typeof reference[key] === 'object' &&
			reference[key] !== null &&
			!Array.isArray(reference[key]) &&
			typeof target[key] === 'object' &&
			target[key] !== null &&
			!Array.isArray(target[key])
		) {
			result[key] = mergeMissingKeys(reference[key], target[key]);
		}
	}

	return result;
}

async function findLocaleFiles() {
	const entries = await readdir(LOCALES_DIR);
	return entries
		.filter((name) => name.endsWith('.json') && name !== 'en-US.json')
		.sort();
}

async function main() {
	await mkdir(LOCALES_DIR, { recursive: true });

	const reference = await fetchReference();

	const enPath = join(LOCALES_DIR, 'en-US.json');
	await writeFile(enPath, JSON.stringify(reference, null, '\t') + '\n', 'utf-8');
	console.log('Saved en-US.json');

	const localeFiles = await findLocaleFiles();

	for (const fileName of localeFiles) {
		const filePath = join(LOCALES_DIR, fileName);
		const content = await readFile(filePath, 'utf-8');
		const target = JSON.parse(content);

		const merged = mergeMissingKeys(reference, target);
		const mergedJson = JSON.stringify(merged, null, '\t') + '\n';

		if (mergedJson !== content) {
			await writeFile(filePath, mergedJson, 'utf-8');
			console.log(`Updated ${fileName} — new keys added from en-US`);
		} else {
			console.log(`${fileName} is up to date`);
		}
	}

	console.log('\nSync complete.');
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
