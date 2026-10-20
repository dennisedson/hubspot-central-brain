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

/**
 * provision-workflows.ts finds each action by SUBSTRING, in order, and takes
 * the first match. An action whose uid or name contained one of these words
 * would be handed out as that other action's id, and a workflow would call the
 * wrong function — with a 200.
 */
const CLAIMED_BY_PROVISIONING = [
  'linear',
  'asana',
  'poll',
  'youtube',
  'fellow',
  'social',
  'associate_related',
  'associate related',
];

describe('rollup-doc-sync-hsmeta.json', () => {
  it('uses a uid and name the provisioning matchers do not claim', () => {
    const action = load('rollup-doc-sync-hsmeta.json') as {
      uid?: string;
      config: { labels?: { en?: { actionName?: string } } };
    };
    const uid = (action.uid ?? '').toLowerCase();
    const name = (action.config.labels?.en?.actionName ?? '').toLowerCase();
    for (const word of CLAIMED_BY_PROVISIONING) {
      expect(uid, `uid contains "${word}"`).not.toContain(word);
      expect(name, `actionName contains "${word}"`).not.toContain(word);
    }
  });
});

/**
 * Which workflow actions authenticate.
 *
 * Every action's actionUrl is a public URL (see
 * function-endpoints-are-justified.test.ts). Checked 2026-10-20: only four of
 * twelve made the caller prove anything, while a comment claimed all of them
 * did. This holds the truth instead of a comment: an action authenticates —
 * its function declares and verifies SYNC_SHARED_SECRET and the action passes
 * a `sharedSecret` input — or it is named below with the reason it does not
 * yet. A new action cannot join the second group by accident.
 */
const NOT_YET_AUTHENTICATED: Record<string, string> = {
  asana_poll: 'polls Asana; no secret input yet — follow-up',
  fellow_sync: 'Fellow integration unverified (every path 404s) — follow-up',
  generate_social_draft: 'writes a draft property; HubSpot Social not connected (#18) — follow-up',
  video_attribution: 'computes UTM links — follow-up',
  breeze_content_pipeline: "Breeze agent tool: the agent runtime's call shape is unverified (#23)",
  breeze_friction_finder: "Breeze agent tool: the agent runtime's call shape is unverified (#23)",
  breeze_meeting_router: "Breeze agent tool: the agent runtime's call shape is unverified (#23)",
};

const FUNCTIONS_DIR = path.join(__dirname, '..', 'functions');

function functionFor(actionFile: string) {
  const urlPath = (load(actionFile).config.actionUrl ?? '').split('/').pop();
  for (const f of fs.readdirSync(FUNCTIONS_DIR).filter(n => n.endsWith('-hsmeta.json'))) {
    const meta = JSON.parse(fs.readFileSync(path.join(FUNCTIONS_DIR, f), 'utf8')) as {
      uid: string;
      config: { entrypoint: string; endpoint?: { path?: string }; secretKeys?: string[] };
    };
    if (urlPath && meta.config.endpoint?.path === urlPath) {
      const source = meta.config.entrypoint.split('/').pop()!.replace(/\.js$/, '.ts');
      return { meta, source: fs.readFileSync(path.join(FUNCTIONS_DIR, source), 'utf8') };
    }
  }
  return null;
}

describe('workflow actions authenticate, or say why not', () => {
  describe.each(files.filter(f => load(f).config.actionUrl))('%s', file => {
    const fn = functionFor(file);

    it('posts to a function that exists', () => {
      expect(fn, `${file}: no function publishes its actionUrl path`).not.toBeNull();
    });

    it('checks the shared secret end to end, or is a named exception', () => {
      if (!fn) return;
      const declares = (fn.meta.config.secretKeys ?? []).includes('SYNC_SHARED_SECRET');
      const verifies = fn.source.includes('verifySharedSecret');
      const passes = (load(file).config.inputFields ?? []).some(i => i.typeDefinition.name === 'sharedSecret');
      const authenticated = declares && verifies && passes;

      if (fn.meta.uid in NOT_YET_AUTHENTICATED) {
        // Keeps the list honest: once one is fixed, it must leave the list.
        expect(authenticated, `${fn.meta.uid} now authenticates — remove it from NOT_YET_AUTHENTICATED`).toBe(false);
      } else {
        expect({ declares, verifies, passes }, `${fn.meta.uid} must declare, verify and receive SYNC_SHARED_SECRET`)
          .toEqual({ declares: true, verifies: true, passes: true });
      }
    });
  });
});

describe('youtube-sync-hsmeta.json — sharedSecret', () => {
  // HubSpot refuses to add a REQUIRED input to an action that is already
  // deployed: Deploy › Dev failed on 2026-10-20 with
  //   BACKWARDS_INCOMPATIBLE_CHANGE_NEW_REQUIRED_FIELD — "Required field
  //   `sharedSecret` would break active enrollments missing a value for it."
  // Optional is enough: youtube_sync_action answers 401 without the secret, so
  // the function enforces what the definition cannot.
  it('declares the secret input as optional', () => {
    const field = (load('youtube-sync-hsmeta.json').config.inputFields ?? [])
      .find(f => f.typeDefinition.name === 'sharedSecret') as { isRequired?: boolean } | undefined;
    expect(field, 'sharedSecret input is missing').toBeDefined();
    expect(field?.isRequired).toBe(false);
  });
});
