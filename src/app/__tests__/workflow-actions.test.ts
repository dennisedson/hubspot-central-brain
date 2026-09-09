import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

/**
 * Schema invariants for every *-hsmeta.json in src/app/workflow-actions/.
 *
 * WHY THIS EXISTS
 * ---------------
 * These files are validated server-side, at `hs project upload`. Nothing local
 * reads them: `tsc` does not see JSON, and `npm run build` only hands the .ts
 * entrypoints to esbuild. So a malformed action passes lint, typecheck, tests
 * and build, and fails in CI at the deploy step — after a push, with the whole
 * build rejected rather than just that component.
 *
 * That is exactly how build #224 failed:
 *
 *     Input field definition must have exactly one supportedValueType;
 *     action value types: [OBJECT_PROPERTY, STATIC_VALUE]
 *
 * Two fields on a new action declared both value types. Every rule below is one
 * this repo has actually been burned by, so each is a regression test rather
 * than a guess about what HubSpot might dislike.
 */

const ACTIONS_DIR = path.join(__dirname, '..', 'workflow-actions');

interface InputField {
  typeDefinition: { name: string };
  supportedValueTypes?: string[];
}

interface ActionConfig {
  actionUrl?: string;
  supportedClients?: Array<{ client: string }>;
  inputFields?: InputField[];
}

const files = fs.readdirSync(ACTIONS_DIR).filter((f) => f.endsWith('-hsmeta.json'));

function load(file: string): { uid?: string; config: ActionConfig } {
  return JSON.parse(fs.readFileSync(path.join(ACTIONS_DIR, file), 'utf8'));
}

describe('workflow-action hsmeta files', () => {
  it('finds action definitions to check', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  describe.each(files)('%s', (file) => {
    const action = load(file);

    it('is valid JSON with a uid and config', () => {
      expect(action.uid).toBeTruthy();
      expect(action.config).toBeTruthy();
    });

    // The failure that broke build #224.
    it('gives every input field exactly one supportedValueType', () => {
      for (const field of action.config.inputFields ?? []) {
        const types = field.supportedValueTypes ?? [];
        expect(
          types,
          `${file}: input field "${field.typeDefinition.name}" declares ${types.length} ` +
            `value types (${JSON.stringify(types)}). HubSpot requires exactly one.`,
        ).toHaveLength(1);
      }
    });

    it('declares at least one supported client', () => {
      expect(action.config.supportedClients?.length ?? 0).toBeGreaterThan(0);
    });

    // Episodes 11 and 43: an actionUrl carrying an unresolved placeholder, or
    // pointing at a portal other than the one being deployed to, ships green.
    it('has an actionUrl with no unresolved placeholder', () => {
      const url = action.config.actionUrl;
      if (url === undefined) return; // agent-only tools may omit it
      expect(url, `${file}: actionUrl contains an unresolved \${...}`).not.toContain('${');
      expect(url, `${file}: actionUrl is not an hs-sites serverless URL`).toMatch(
        /^https:\/\/\d+\.hs-sites\.com\/hs\/serverless\/[a-z0-9-]+$/,
      );
    });

    it('names input fields uniquely', () => {
      const names = (action.config.inputFields ?? []).map((f) => f.typeDefinition.name);
      expect(new Set(names).size, `${file}: duplicate input field name`).toBe(names.length);
    });
  });
});
