/**
 * Descarga los archivos de traducción más recientes desde la rama develop
 * del repositorio de CubicLauncher.
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOCALES_DIR = join(__dirname, '..', 'src', 'locales');

const OWNER = 'CubicLauncherDevs';
const REPO = 'CubicLauncher';
const BRANCH = 'develop';
const REPO_PATH = 'src/lib/i18n';
const LOCALES = ['en', 'es', 'fr', 'de', 'uk'];

async function fetchLocale(code) {
	const url = `https://raw.githubusercontent.com/${OWNER}/${REPO}/${BRANCH}/${REPO_PATH}/${code}.json`;
	console.log(`Downloading ${code}.json...`);

	const response = await fetch(url);
	if (!response.ok) {
		throw new Error(`Failed to download ${code}.json: ${response.status} ${response.statusText}`);
	}

	const text = await response.text();
	const data = JSON.parse(text);
	const fileName = `${typeof data.id === 'string' ? data.id : code}.json`;

	const filePath = join(LOCALES_DIR, fileName);
	await writeFile(filePath, text, 'utf-8');
	console.log(`Saved ${filePath}`);
}

async function main() {
	await mkdir(LOCALES_DIR, { recursive: true });

	for (const code of LOCALES) {
		await fetchLocale(code);
	}

	console.log('\nAll locales downloaded successfully.');
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
