Review-Type: readability
Task-ID: ch23s05-p0076-p0080-r1
Source-Blind: YES
Draft-SHA256: 157714133016a679da73d588dd250fd191f04a81112a34b65b398e784b532aa3
Verdict: PASS

## One-read paraphrases

- C1: 肯宁顿明明需要工人，却拆房不建房，白喉暴发时居民已经挤在被称为“鸟笼”的微小房间里。
- C2: 表格列出“鸟笼”四种房间的长宽高。
- C3: 地主合并农场、农场主又不充分耕种，导致田地缺人而工人失业，工人夏季过劳、冬季挨饿。
- C4: 弗洛尔多个家庭把许多成年人和孩子挤进一间卧室，甚至有6个患猩红热的孩子同成人共住。
- C5: 脚注把工人方言解释为牧师和乡绅串通起来逼死他们。

## Reader questions

- C1 Q: 肯宁顿的住房为何被叫作“鸟笼”？ A: 每所房子虽然分四间，但各房间的尺寸都非常小。
- C2 Q: 表中最窄的是哪间房？ A: 洗涤间，宽4英尺6英寸。
- C3 Q: 为什么田地需要人手，工人却找不到工作？ A: 农场合并且租地农场主没有充分耕种现有土地。
- C4 Q: 弗洛尔列出的共同问题是什么？ A: 许多成人和孩子被迫共用一间很小的卧室。
- C5 Q: 工人那句方言表达什么情绪？ A: 他们认为牧师和乡绅合力把自己逼到绝境。

## Transition evidence

- C1: S1->S2=先交代白喉和调查，再给需要劳动力却拆房不建的发现，signal=“他发现……明明……却”；S2->S3=总体住房政策后引出4所极小房屋实例，signal=“当地有4所”；S3->S4=说出“鸟笼”名称后说明每所房间数并引表，signal=“每所……尺寸如下”。
- C2: 单一表格，无相邻句对。
- C3: S1->S2=先写冬季20—30人失业，再解释耕种不足和农场合并两项原因，signal=“于是造成”；S2->S3=就业原因后转到田地本身仍缺劳动，signal=“沟的一边”；S3->S4=田地需要人手后对照沟另一边工人无工，signal=“沟的另一边”；S4->S5=空间对照后扩展为夏季过劳、冬季挨饿的全年节奏，signal=“夏天……冬天却”；S5->S6=生活循环后推出工人的愤怒判断，signal=“难怪”。
- C4: S1->S2=先概括弗洛尔有多个拥挤例子，再列夫妇与4—6个孩子，signal=“有的”；S2->S3=第一类家庭后列3名成人5个孩子，signal=“有的是”；S3->S4=第二类后列含祖父和6名病童的一户，signal=“还有一户”；S4->S5=一室案例后补两所两室房中的8名和9名成人家庭，signal=“另外”。
- C5: 单句，解释正文中的方言引文。

## Scope and closure audit

- C1: scope=“明明需要大量劳动力，却”限定住房拆除发生在劳动需求仍高的地区 | invariant=住房供给没有随劳动需求增加 | anchor=“一所新房也没有补建”
- C1: scope=“一所新房也没有”排除任何补建住房 | invariant=原有小屋被拆后供给净减少 | anchor=“却拆掉了好几所小屋，一所新房也没有补建”
- C3: scope=“把所有租地农场合并成两三家”限定地主所控制租地的集中结果 | invariant=集中和耕种不足共同造成就业减少 | anchor=“于是造成就业不足”
- C3: scope=“夏天……冬天却”区分同一批工人的季节处境 | invariant=全年结果不是稳定就业，而是在过劳与半饥饿间摆动 | anchor=“夏天，他们被逼得拼命干活，冬天却处于半饥饿状态”
- C4: scope=“4个、5个甚至6个孩子”表示多户同类案例而非同一户三组孩子 | invariant=这些案例共同是一对夫妇同多名孩子挤住一室 | anchor=“有的最小规格卧室里，住着一对夫妇”

## Second-read risks

- No unresolved T findings.
- S1（C1）：四组尺寸适合查表而不适合塞进句子，正文先说明表格功能，读者可以跳过细读而不丢失论点。
- A1（C4）：8名和9名“成年人”看起来异常，但这是原材料的明确统计，译文没有擅自改成家庭总人数。

## Paragraph and punctuation audit

- p0076对应一个正文引表段和一个Markdown表格，p0078、p0079各对应一个正文段，p0077、p0080对应地区标题，另保留note-077。
- Boundary-Changes: p0076尺寸表转为标准Markdown表；p0079仍为同一正文段，仅把分号串联案例拆成自然中文句子。
- Semicolons: 0
- Semicolon rationale: none; parallel examples and the ditch contrast were written as full Chinese sentences.
- Translator-Notes: 0; [^168a] is a source note.
- Sentence-Coverage: C1=4, C2=1, C3=6, C4=5, C5=1; total=17 sentences and 12 adjacent sentence pairs. Every adjacent pair in each multi-sentence block is recorded above.
