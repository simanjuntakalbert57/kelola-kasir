// Generates src/generated/openapi.ts from docs/api/openapi.yaml.
// `--check` fails when the committed file is out of date (used in CI).
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import openapiTS, { astToString } from 'openapi-typescript';

const specPath = fileURLToPath(new URL('../../../docs/api/openapi.yaml', import.meta.url));
const outPath = fileURLToPath(new URL('../src/generated/openapi.ts', import.meta.url));
const header =
  '// AUTO-GENERATED from docs/api/openapi.yaml by `pnpm contracts:generate`. Do not edit.\n';

const ast = await openapiTS(pathToFileURL(specPath), { alphabetize: false });
const output = header + astToString(ast);

if (process.argv.includes('--check')) {
  const current = await readFile(outPath, 'utf8').catch(() => '');
  if (current !== output) {
    console.error(
      'packages/contracts/src/generated/openapi.ts is out of date. Run `pnpm contracts:generate` and commit the result.',
    );
    process.exit(1);
  }
  console.warn('contracts are up to date');
} else {
  await writeFile(outPath, output);
  console.warn(`wrote ${outPath}`);
}
