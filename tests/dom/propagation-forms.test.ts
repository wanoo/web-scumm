// @vitest-environment happy-dom
// The Studio's side of tests/propagation.test.ts (4.1.12, D22): every objective of the fixture edited by the form
// generated from its schema, and every command of the DSL by the command editor, each read back as it was given.
import { describe, expect, it } from 'vitest';
import { CMD_KEYS } from '@engine/core/cmds';
import { objectiveSchema } from '@engine/core/ir-schema';
import type { GameInfo } from '../../src/studio/api';
import { cmdsEditor } from '../../src/studio/forms';
import { objectForm } from '../../src/studio/forms-gen';
import { CMD_SPECS } from '../../src/studio/schema';
import { quest } from '../fixtures/objectives';
import { sample } from '../fixtures/samples';

const info = { rooms: [], characters: {}, items: {}, verbs: [], checkpoints: {}, images: {} } as unknown as GameInfo;

describe('the Studio edits every public primitive', () => {
  it('each objective, through the form generated from its schema', () => {
    for (const o of Object.values(quest().objectives!))
      expect(objectForm(objectiveSchema, o, { info }).get()).toEqual(o);
  });

  it('each command, through the command editor', () => {
    for (const k of CMD_KEYS) {
      const spec = CMD_SPECS[k];
      const cmd = {
        [k]: sample(spec.value),
        ...Object.fromEntries(
          Object.entries(spec.extra ?? {})
            .filter(([, f]) => !f.optional)
            .map(([x, f]) => [x, sample(f)]),
        ),
      };
      expect(cmdsEditor([cmd as never], { info }).get(), k).toEqual([cmd]);
    }
  });
});
