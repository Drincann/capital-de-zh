Review-Type: readability
Task-ID: ch23s05-p0126-p0129-r1
Source-Blind: YES
Draft-SHA256: c7e272635b5b3d787a2673c405e1dec9d1f8bd54863ec65330b24e802ac12ead
Verdict: PASS

## One-read paraphrases

- C1: 下表统计1864年爱尔兰租佃地的数量和面积。
- C2: 土地越大的等级数量越少，但超过100英亩的租地占有最大的合计面积。
- C3: 按土地集中和牧场化的逻辑，将有约171万人被视为多余并需要移民，爱尔兰最终只为英国畜牧服务。
- C4: 被牲畜赶出爱尔兰的人在美国成为反英民族主义者，使美国对英国的威胁增强。
- C5: 结尾诗句把这种后果概括为手足相残的罪孽。
- C6: 表中总面积包含泥炭地和荒地。
- C7: 饥荒、立法和贸易政策都被用来推动牧场化和人口驱逐，所谓土地天然用途也随英国政策需要而改变。

## Reader questions

- C1 Q: 这份表格统计什么时间和地区？ A: 1864年的爱尔兰。
- C2 Q: 超过100英亩的租地合计有多大？ A: 8,227,807英亩。
- C3 Q: 为什么最后算出约171万人要移民？ A: 不超过15英亩和15—100英亩两组租地都被判定不适合新的资本主义农业。
- C4 Q: 移民怎样反过来威胁英国？ A: 在美国积累起来的爱尔兰移民成为反抗英国统治的芬尼亚运动成员。
- C5 Q: 诗句把问题归结为什么？ A: 手足相残的罪孽。
- C6 Q: 总面积除农牧用地外还包括什么？ A: 泥炭地和荒地。
- C7 Q: 为什么人们对爱尔兰土地用途的判断在1846年前后突然反转？ A: 英国废除谷物法后，爱尔兰向英国输入谷物的政策优势消失，牧场化符合新的利益需要。

## Transition evidence

- C1: 单句标题，无相邻句对。
- C2: 单句表格，无相邻句对。
- C3: S1->S2=先说明土地集中已消灭前三类租地，再以达弗林逻辑说它们必须消失，signal=“按照达弗林的逻辑”；S2->S3=判定租地消失后算出租户人数，signal=“这样”；S3->S4=租户人数后按每户4人换算总人口，signal=“即使……也”；S4->S5=总人口后再扣除假定可吸纳的四分之一，signal=“再作一个……假设”；S5->S6=算完前三类后转到第4—6类，signal=分类推进；S6->S7=给出面积范围后说明为何也会被淘汰，signal=“这样的面积”；S7->S8=判断不适合后按同一假设算迁出人数，signal=“按同样的假设”；S8->S9=第二组人数后相加，signal=“两项合计”；S9->S10=数字结论后转入胃口扩大的反讽，signal=短句转折；S10->S11=胃口扩大后写地租逻辑还会继续发现过剩人口，signal=“很快就会发现”；S11->S12=人口仍被说成过多后推出继续减少和牧场使命，signal=“因此”。
- C4: S1->S2=先对照地租与美国爱尔兰人同时积累，再说明移民成为芬尼亚成员，signal=“被……赶走以后，又”；S2->S3=民族主义力量形成后说明美国对英国威胁增长，signal=“于是”。
- C5: 单句，无相邻句对。
- C6: 单句，无相邻句对。
- C7: S1->S2=先预告第三卷详细说明，再补将讨论的小租户和工人，signal=“那里还会”；S2->S3=预告后限定这里只引一段，signal=“这里仅”；S3->S4=宣布引文后介绍西尼尔及内容，signal=作者和书目；S4->S5=列出济贫法和移民工具后继续引述战争与牧场化结论，signal=引文延续；S5->S6=引文结束后转入谷物法这一政策背景，signal=“1815年的英国谷物法”；S6->S7=政策优势后说明1846年被取消，signal=“1846年……突然消失”；S7->S8=优势消失后说明它足以推动牧场化集中和驱逐，signal=“单是这件事就足以”；S8->S9=政策作用后回顾废法前对土地用途的说法，signal=“1815—1846年”；S9->S10=废法前适合小麦后对照废法后只适合饲料，signal=“以后……却突然”；S10->S11=英国说法反转后写拉韦涅跟随重复，signal=“也赶紧”；S11->S12=重复行为后用讽刺作出评价，signal=“只有……才”。

## Scope and closure audit

- C2: scope=各行“不超过”和“超过”只规定互不重叠的面积等级 | invariant=每块租佃地只进入一个等级并保留对应数量和面积 | anchor=“每块租佃地的面积”
- C3: scope=“其中四分之一还能重新找到位置”是作者明确称为极其夸张的宽松假设 | invariant=即使接受该假设，前三类租地人口仍有921,174人必须移民 | anchor=“余下仍有921,174人必须移民”
- C7: scope=“即使不考虑其他条件”暂时排除谷物法之外的成因 | invariant=仅谷物法优势消失已足以强力推动牧场化和驱逐 | anchor=“单是这件事就足以有力推动爱尔兰耕地变成牧场、租地农场集中和小农被驱逐”

## Second-read risks

- No unresolved T findings.
- S1（C3）：三分之一百万与1,709,532人的差异承接上一批对达弗林公开说法和其土地逻辑的区分，本段逐步展示后一个数字怎样算出。
- A1（C5）：罗马诗句与英爱美三方关系的具体对应由作者留给读者，译文只译诗句，不代替作者补出唯一解释。

## Paragraph and punctuation audit

- p0126以C1标题、C2表格呈现；p0127—p0129分别对应C3—C5；notes 188a、188b对应C6—C7。正文段界未改变。
- Boundary-Changes: p0126 original wide two-panel table -> one narrow three-column table; this is a layout normalization for mobile readability, not a prose paragraph split.
- Semicolons: 1
- Semicolon rationale: C7的西尼尔原始引文把济贫法与移民并列为帮助地主的两个工具，分号能最清楚保留直接并列。
- Translator-Notes: 0; both notes are source notes, and “芬尼亚运动成员” is a direct lexical expansion in the main text.
- Sentence-Coverage: C1=1, C2=1, C3=12, C4=3, C5=1, C6=1, C7=12; total=31 sentences and 24 adjacent sentence pairs. Every adjacent pair in each multi-sentence block is recorded above.
