// The dialogue tree of a character, derived from its talk topics: topics, lines, choices and their options, branches
// (`if`), nested conversations. Read-only and purely derived: the DSL (topics + choice + if) is the dialogue graph,
// this only lays it out for the Studio and the `dialogue_tree` tool. No second format, nothing to keep in sync.
import type { Cmd, TalkTopic } from '../core/types';
import { condText } from './condtext';
import { must } from '../core/must';

export interface DialogueNode {
  kind: 'topic' | 'line' | 'choice' | 'option' | 'if' | 'else' | 'talk' | 'end' | 'other';
  /** The text shown: the topic, the line, the option, the condition. */
  text: string;
  /** Who says it (lines). */
  who?: string;
  /** The gate (topics, options, branches). */
  cond?: string;
  /** The content path of the text (`talk.lou[2].do[0].say[1]`), the Studio's editors' `data-path`. */
  path?: string;
  children?: DialogueNode[];
}

function cmds(list: Cmd[] | undefined, path: string): DialogueNode[] {
  const out: DialogueNode[] = [];
  list?.forEach((c, i) => {
    const p = `${path}[${i}]`;
    if (typeof c === 'string') {
      out.push({ kind: 'line', text: c, who: 'hero', path: p });
      return;
    }
    if ('say' in c) out.push({ kind: 'line', text: c.say[1], who: c.say[0], path: `${p}.say[1]` });
    else if ('choice' in c)
      out.push({
        kind: 'choice',
        text: 'choice',
        children: c.choice.map((o, j) => ({
          kind: 'option',
          text: o.text,
          cond: o.if === undefined ? undefined : condText(o.if),
          path: `${p}.choice[${j}].text`,
          children: cmds(o.do, `${p}.choice[${j}].do`),
        })),
      });
    else if ('if' in c) {
      out.push({ kind: 'if', text: `if ${condText(c.if)}`, cond: condText(c.if), children: cmds(c.then, `${p}.then`) });
      if (c.else?.length) out.push({ kind: 'else', text: 'else', children: cmds(c.else, `${p}.else`) });
    } else if ('talk' in c) out.push({ kind: 'talk', text: `talk ${c.talk}` });
    else if ('once' in c) out.push({ kind: 'if', text: 'once', children: cmds(c.once, `${p}.once`) });
    else if ('nth' in c)
      c.nth.forEach((b, j) =>
        out.push({
          kind: 'if',
          text: j === c.nth.length - 1 ? `${j + 1}th time and after` : `${j + 1}${['st', 'nd', 'rd'][j] ?? 'th'} time`,
          children: cmds(b, `${p}.nth[${j}]`),
        }),
      );
    else if ('cycle' in c)
      c.cycle.forEach((b, j) => out.push({ kind: 'if', text: `turn ${j + 1}`, children: cmds(b, `${p}.cycle[${j}]`) }));
    else if ('random' in c)
      c.random.forEach((b, j) =>
        out.push({ kind: 'if', text: `at random ${j + 1}`, children: cmds(b, `${p}.random[${j}]`) }),
      );
    else if ('cutscene' in c) out.push(...cmds(c.cutscene, `${p}.cutscene`));
    else if ('end' in c || 'ending' in c || 'reveal' in c) out.push({ kind: 'end', text: 'the end' });
    else if (
      'set' in c ||
      'unset' in c ||
      'inc' in c ||
      'gain' in c ||
      'lose' in c ||
      'goto' in c ||
      'emit' in c ||
      'moveActor' in c ||
      'transfer' in c ||
      'switchPlayer' in c ||
      'minigame' in c
    ) {
      const k = must(Object.keys(c)[0], 'command key');
      const v = (c as Record<string, unknown>)[k];
      out.push({ kind: 'other', text: `${k} ${Array.isArray(v) ? v.join(' ') : String(v)}` });
    }
  });
  return out;
}

/** The tree of a character's topics (`room.talk[actor]`); `path` is the prefix of their content paths (`talk.lou`). */
export function dialogueTree(topics: TalkTopic[], path = 'talk'): DialogueNode[] {
  return topics.map((t, i) => ({
    kind: 'topic',
    text: t.topic,
    cond: t.if === undefined ? undefined : condText(t.if),
    path: `${path}[${i}].topic`,
    children: cmds(t.do, `${path}[${i}].do`),
  }));
}

/** The tree as indented text (the `dialogue_tree` tool, the terminal). */
export function dialogueText(nodes: DialogueNode[], depth = 0): string {
  const pad = '  '.repeat(depth);
  return nodes
    .map((n) => {
      const head =
        n.kind === 'topic'
          ? `▸ "${n.text}"`
          : n.kind === 'line'
            ? `${n.who}: ${n.text}`
            : n.kind === 'option'
              ? `○ "${n.text}"`
              : n.kind === 'choice'
                ? '?'
                : n.text;
      return `${pad}${head}${n.cond && n.kind !== 'if' ? `  [if ${n.cond}]` : ''}${n.children?.length ? '\n' + dialogueText(n.children, depth + 1) : ''}`;
    })
    .join('\n');
}

export { condText };
