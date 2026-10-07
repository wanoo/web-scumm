// A value for each field of the Studio's command forms (src/studio/schema.ts), enough for the IR's schema and the
// Studio's editors to read: the propagation tests (tests/propagation.test.ts, tests/dom/propagation-forms.test.ts).
import type { Field } from '../../src/studio/schema';

/** A value of a Studio field, enough for a schema and a form to read (ids as plain words). */
export function sample(f: Field): unknown {
  switch (f.k) {
    case 'text':
    case 'id':
      return 'x';
    case 'number':
      return f.min ?? 1;
    case 'bool':
      return true;
    case 'enum':
      return f.values[0];
    case 'point':
    case 'idOrPoint':
      return [10, 20];
    case 'cond':
      return 'f';
    case 'cmds':
      return ['A line.'];
    case 'tuple':
      return f.items.map(sample);
    case 'list':
      return [sample(f.of)];
    case 'object':
      return Object.fromEntries(
        Object.entries(f.fields)
          .filter(([, x]) => !x.optional)
          .map(([k, x]) => [k, sample(x)]),
      );
    case 'json':
      return { a: 1 };
  }
}
