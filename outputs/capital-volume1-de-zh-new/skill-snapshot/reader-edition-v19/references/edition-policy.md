# Edition policy

## 1. Default textual basis

For a no-cost project using publicly downloadable text, use this hierarchy unless
the user makes another explicit editorial choice:

| Source | Project role | Authority and limitation |
|---|---|---|
| German fourth edition, Hamburg 1890, MEGA II/10 | Base | Official MEGAdigital scholarly text is publicly downloadable; edited by Engels after Marx's death |
| French edition, Paris 1872–1875, MEGA II/7 | Continuous author-revised witness | Human-corrected Wikisource text linked to page images; translation by Joseph Roy, entirely revised by Marx |
| German second edition, Hamburg 1872, MEGA II/6 | Principal authorial witness | Last German edition substantially revised and published under Marx's supervision; no public MEGAdigital full text is currently available, so public copies must be checked against the facsimile passage by passage |
| German first edition, Hamburg 1867, MEGA II/5 | Historical witness | Official MEGAdigital scholarly text is publicly downloadable; superseded in major parts, especially the opening analysis |

The official MEGA volume list is the edition authority:
https://mega.bbaw.de/de/mega-baende/ii-abteilung

Relevant authorial and editorial statements:

- Marx, afterword to the second German edition:
  https://www.marxists.org/archive/marx/works/1867-c1/p3.htm
- Marx, afterword to the French edition:
  https://www.marxists.org/archive/marx/works/1867-c1/p4.htm
- Engels, preface to the third German edition:
  https://www.marxists.org/archive/marx/works/1867-c1/p5.htm
- Engels, preface to the fourth German edition:
  https://www.marxists.org/archive/marx/works/1867-c1/p7.htm

## 2. Source acceptance

A source is usable only after recording:

- bibliographic title, edition, publisher, place, year, and language;
- repository and stable item URL;
- whether the local object is a facsimile, human transcription, OCR, or derivative;
- local path, byte length, SHA-256 checksum, and acquisition date;
- verification status and any known defects.

Prefer, in order:

1. scholarly edition or original-edition facsimile;
2. human-corrected transcription linked to page images;
3. OCR linked to a facsimile;
4. unattributed plain text only as a search aid.

Never infer edition from the filename alone. Verify the title page and at least one
edition-specific passage.

Raw OCR may be retained as `search-aid-only`. Never copy a sentence from it into
the translation source layer until that sentence has been checked against the
facsimile. A page- and line-accurate MEGAdigital XML/HTML text is not OCR and may
serve directly as a source after its edition metadata is verified.

For a MEGAdigital section that contains nested subdivisions, use
`scripts/extract_mega_section_recursive.py`. It preserves nested headings as
stable source items. Do not use a direct-child-only extractor for such a section;
it can silently omit most of the text. Compare the extracted item count and the
last item against the XML container before locking the source hash. Also audit
every TEI `table` in the selected container. MEGAdigital uses tables not only for
statistics but for argument-bearing value equations. Preserve every row and
cell, attach a displayed table to the sentence or heading that introduces it,
and verify the number of extracted tables against the XML before issuing task
packages.

## 3. Source layers

Keep these layers distinct:

- `facsimile`: page images or a faithful scan;
- `raw`: repository transcription or OCR, unchanged;
- `normalized`: mechanical cleanup with page anchors retained;
- `aligned`: paragraph units mapped across witnesses;
- `translation`: Chinese draft and approved text.

Do not overwrite a raw source. Every normalization must be reproducible or recorded.

## 4. Variant classification

Use one of these codes for each material difference:

- `ORTH`: spelling or punctuation only;
- `STYLE`: wording or sentence structure without a material change in claim;
- `CLAR`: explicit clarification of a recoverable meaning;
- `ADD`: content added in a witness;
- `OMIT`: content absent from a witness;
- `MOVE`: content moved;
- `CLAIM`: proposition, logical relation, scope, or qualification changed;
- `TERM`: recurring conceptual expression changed;
- `DATA`: figure, unit, name, quotation, or historical information changed;
- `UNCERTAIN`: alignment or meaning remains unresolved.

`ORTH` and `STYLE` normally need no public note. `ADD`, `OMIT`, `CLAIM`, `TERM`,
`DATA`, and unresolved `UNCERTAIN` require a recorded editorial decision.

## 5. Decision policy

- Keep the base text when witnesses merely paraphrase it.
- Use the French witness to understand meaning and to write natural Chinese, but
  do not present French-only content as though it were in the German base.
- Incorporate witness-only content into the Chinese main text only when the project
  has explicitly chosen an editorially integrated reader's edition. Record the
  exact source and reason.
- Otherwise retain the base translation and put important witness material in a
  short textual note or appendix.
- If a witness exposes a likely OCR error, verify the base facsimile before fixing.
- Do not resolve a disputed conceptual reading by consulting an existing Chinese
  translation during the independent draft.

## 6. Public edition statement

Use this wording for the current no-cost public-source project:

> 本译本以MEGAdigital提供的1890年德文第四版校勘文本为底本，逐段参校马克思亲自修订的1872—1875年法文版；涉及重要版本差异时，核对1872年德文第二版原书，并查阅MEGAdigital的1867年德文第一版。凡参校本造成实质性增补或改动，均另作版本记录。

If a reliable full text of the 1872 edition is later supplied, record a project-wide
decision before changing the base. Do not mix base editions chapter by chapter.
