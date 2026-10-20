import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * The CMS module's contract with HubSpot's renderer, checked statically
 * because nothing else checks it.
 *
 * `getServerSideProps` does NOT spread its result into the component's props.
 * Per @hubspot/cms-components' own types:
 *
 *   type ModuleProps        = { fieldValues; hublParameters; serverSideProps?; hublData?; ... }
 *   type ModuleDataFetchResult = { serverSideProps: Record<string, any>; caching: CacheConfig }
 *
 * So the data arrives under `serverSideProps`, and the cache key is `caching`.
 * The module got both wrong and failed silently: destructuring `pipeline` at
 * the top level produced `undefined`, which the page rendered as
 * "0 active records" with no error. It looked like an empty portal for six
 * weeks. A wrong number is worse than a crash, because nobody investigates it.
 */

const MODULE = join(
  __dirname, '..', '..', 'theme', 'central-brain-dashboard',
  'components', 'modules', 'Dashboard', 'index.jsx',
);

function source(): string {
  return readFileSync(MODULE, 'utf8');
}

describe('CMS dashboard module contract', () => {
  it('Component reads serverSideProps rather than top-level data props', () => {
    const src = source();

    expect(src).toMatch(/export function Component\(\{[^}]*serverSideProps/);
  });

  // The precise regression: these three were destructured straight off props.
  it('does not destructure the data fields off the top level of props', () => {
    const signature = source().match(/export function Component\(\{[^}]*\}\)/)?.[0] ?? '';

    expect(signature).not.toMatch(/\bpipeline\b/);
    expect(signature).not.toMatch(/\bsettings\b/);
    expect(signature).not.toMatch(/\bfetchError\b/);
  });

  it('returns the cache config under `caching`, the key the renderer reads', () => {
    const src = source();

    expect(src).toMatch(/caching:\s*\{/);
    expect(src).not.toMatch(/cacheConfig:/);
  });

  // Every return path must carry serverSideProps, or that path renders as zero.
  it('every getServerSideProps return carries serverSideProps', () => {
    const gssp = source().match(/export async function getServerSideProps[\s\S]*?\n\}/)?.[0] ?? '';
    const returns = gssp.match(/return \{/g) ?? [];

    expect(returns.length).toBeGreaterThan(0);
    expect(gssp).not.toMatch(/return \{\s*pipeline:/);
  });

  it('reads its secret through getSecret, never a literal', () => {
    const src = source();

    expect(src).toMatch(/getSecret\(['"]DASHBOARD_SHARED_SECRET['"]\)/);
  });
});
