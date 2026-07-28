# Plain-Chinese reader's-edition standard

## 1. Purpose and reader

This edition exists so that a reader with high-school or undergraduate education,
but no training in economics, philosophy, or Marxist terminology, can understand
the argument without a teacher beside them.

The final Chinese should feel like a serious contemporary nonfiction book
originally written in Chinese. It is not an academic critical edition, a
word-for-word crib, a modernization of an older Chinese translation, a summary,
or a separate reading guide.

The decisive test is not “Can a specialist reconstruct every German expression?”
It is “Can a new reader say, after one reading, what Marx is claiming and why the
next sentence follows?”

## 2. What may and may not be sacrificed

When clarity conflicts with formal fidelity, preserve in this order:

1. the paragraph's core claim and role in the larger argument;
2. causal, conditional, contrastive, inferential, and quantitative relations;
3. distinctions between concepts that later reasoning depends on;
4. facts, examples, names, numbers, formulas, and quoted positions;
5. useful qualifications and rhetorical force;
6. repetition, metaphor, minor detail, source sentence shape, and word order.

The translator may freely:

- split, merge, and reorder sentences;
- replace pronouns with their actual referents;
- turn nouns into verbs and abstractions into concrete actions;
- state an intermediate step that is securely entailed but compressed in the
  source;
- shorten redundant repetition;
- replace an opaque metaphor with its direct meaning, or retain it and explain it;
- vary paragraph length and punctuation;
- omit a minor stylistic detail whose retention would materially obscure the
  argument.

The translator may not:

- reverse, weaken, or strengthen the core claim;
- change who causes or conditions what;
- turn “some” into “all”, possibility into certainty, or description into praise;
- merge distinctions such as value/price, labour/labour-power, or
  product/commodity when the argument relies on them;
- invent a modern example, historical fact, motive, or conclusion and present it
  as Marx's own;
- conceal a genuine ambiguity behind a confident paraphrase;
- make a contested interpretation sound like an undisputed source statement.

If a deliberate simplification changes a meaningful but non-core detail, record
it in the internal decision log. The reader need not see the apparatus unless the
choice could mislead them.

## 3. Chinese prose rules

- Prefer words used in ordinary serious conversation today.
- Use direct subject–verb–object sentences whenever possible.
- Keep one main action or inference per sentence.
- Name the actor. Avoid long chains of “它、这、其、这种” with uncertain
  referents.
- Put the logical connector where the reader needs it: “因为”, “所以”, “但”,
  “只有”, “也就是说”, “换句话说”, “反过来”.
- Prefer concrete verbs to phrases such as “对……进行……”“使……得以实现”.
- Replace inherited translationese unless the term is genuinely needed.
- Avoid literary archaism, bureaucratic phrasing, decorative synonyms, and
  German-shaped clause nesting.
- Preserve sharpness and irony in living Chinese, not stiff academic prose.
- Read every paragraph aloud. If it cannot be spoken naturally, revise it.

Unacceptable:

> 所有那些通过劳动只是同土地脱离直接联系的东西，都是天然存在的劳动对象。

Acceptable:

> 有些劳动只是把现成的自然物从原来的环境中取出来，比如捕鱼、伐木和采矿。

The acceptable version changes the grammar and groups Marx's examples with the
claim, but makes the intended distinction immediately visible.

## 4. Concepts and terminology

Use the least technical stable term that preserves a distinction needed by the
argument. A familiar word is better than inherited jargon when it works across
the relevant contexts.

For each recurring concept:

1. collect representative contexts;
2. identify the contrasts that must remain visible;
3. test plain-Chinese candidates;
4. choose a default and record its meaning, limits, and rejected alternatives;
5. allow contextual variation when the German word is ordinary rather than a
   fixed concept.

Do not add an old Chinese term in parentheses merely for scholarly reassurance.
If a conventional term is needed for later recognition, introduce it naturally,
for example: “生产时使用的条件和工具（通常叫作生产资料）”. Do this only when
it helps the reader.

## 5. Inline translator notes

Use the exact form:

```text
〔译者注：……〕
```

A note is justified when it:

- prevents a predictable modern misunderstanding;
- identifies historical information the sentence assumes;
- distinguishes Marx's term from its ordinary present-day meaning;
- marks a real ambiguity or a consequential interpretive choice;
- gives a short contemporary analogy that illuminates, but does not replace, the
  argument.

Rules:

- Place the note immediately after the relevant phrase.
- Use one or two short sentences.
- Normally use no more than one note in a paragraph.
- State clearly what belongs to the translator.
- Do not use notes for ideological commentary, rebuttal, praise, or material that
  can be expressed cleanly in the translation itself.
- Delete any note that merely repairs bad Chinese; rewrite the Chinese instead.

## 6. Meaning audit

For each task, compare the Chinese with the verified source and check:

- the core claim and every indispensable reasoning step remain;
- cause, condition, contrast, inference, negation, quantity, and time remain
  correct;
- key conceptual contrasts remain distinct;
- names, dates, units, formulas, quotations, and footnote attachment are correct;
- simplifications do not create a new factual or theoretical claim;
- additions are either entailed clarifications or clearly marked translator
  notes.

This is not a word-matching audit. Different wording is expected.

## 7. Source-blind readability audit

Read only the Chinese and ask:

- Can a first-time reader identify who is doing what?
- Can the reader explain the point of the paragraph in one sentence?
- Does each sentence visibly follow from the previous one?
- Is any term used before the reader can understand it?
- Does any sentence need a second reading only because of its wording?
- Can a shorter, more ordinary expression say the same thing?

Any “no” is a revision request. Readability review has authority to rewrite the
draft, but the revised text must pass the meaning audit again.

## 8. Final Markdown

Each chapter is one UTF-8 Markdown file:

```markdown
# 第五章 劳动过程和价值增殖过程

## 一、劳动过程

正文……

〔译者注：必要时才出现。〕
```

The released file contains only reader-facing headings, prose, quotations,
formulas, and sparse translator notes. Do not expose German text, paragraph IDs,
edition sigla, task IDs, status markers, review forms, or internal decisions.

