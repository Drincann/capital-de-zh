Review-Type: readability
Task-ID: ch23s05-p0091-p0095-r1
Source-Blind: YES
Draft-SHA256: 411d3c75716f8684df745ca97aee2cc2cfcad08ccf13633ee8e23f0eead9bf97
Verdict: PASS

## One-read paraphrases

- C1: 下面转向爱尔兰，并先看人口、移民、住房和农场规模等事实。
- C2: 饥荒后爱尔兰人口和住房剧减，小农场被大量消灭并并入中大农场。
- C3: 接下来把1861—1865年作为观察窗口，先看人口下降期间的牲畜变化。
- C4: 表A统计牲畜数量。
- C5: 第一张表列马匹持续减少、牛先减后增。
- C6: 第二张表列绵羊和猪的逐年增减。
- C7: 脚注显示爱尔兰人口1801—1841年原本持续上升。

## Reader questions

- C1 Q: 转向爱尔兰后先做什么？ A: 先列同本节问题直接相关的事实。
- C2 Q: 为什么农场总数下降而中大农场数量增加？ A: 15英亩以下的小农场被消灭并并入更大的农场。
- C3 Q: 1861—1865年人口怎样变化？ A: 超过50万人移居国外，总人口净减超过12.5万人。
- C4 Q: 表A的主题是什么？ A: 牲畜数量。
- C5 Q: 1860—1865年马匹总数怎样变化？ A: 每年下降，从619,811匹降到547,867匹。
- C6 Q: 1865年绵羊和猪怎样变化？ A: 分别比上年增加321,801只和241,413头。
- C7 Q: 1841年爱尔兰人口是多少？ A: 8,222,664人。

## Transition evidence

- C1: S1->S2=先宣布简要转向爱尔兰，再说明采用先列事实的方式，signal=“先列出”。
- C2: S1->S2=先给1841—1866人口序列，再说明下降起点是1846年饥荒，signal=“始于”；S2->S3=起点后归纳不到20年的总损失比例，signal=“不到20年”；S3->S4=人口比例后转到移民总量和最近五年，signal=具体时期；S4->S5=移民后补有人居住房屋减少，signal=“1851—1861年”；S5->S6=住房后转到同期农场规模结构，signal=“同期”；S6->S7=各档增减数字后解释总数下降来自小农场集中，signal=“这说明”。
- C3: S1->S2=先说人口下降通常伴随产量下降，再限定只看五年，signal=“这里只看”；S2->S3=限定时间后给移民和人口净减两项规模，signal=“这五年”；S3->S4=人口变化后引出牲畜表，signal=“下面先看”。
- C4: 单句，作为两张表的共同标题。
- C5: 单一表格，无相邻句对。
- C6: 单一表格，无相邻句对。
- C7: 单句，无相邻句对。

## Scope and closure audit

- C1: scope=“简要看看爱尔兰”限定本节这里只处理同当前问题直接有关的材料 | invariant=下文先从可核对事实开始 | anchor=“先列出同这里的问题直接有关的事实”
- C2: scope=“其中仅1861—1865年五年”从长期移民总量中截取最近五年 | invariant=这五年移民已超过50万人 | anchor=“其中仅1861—1865年五年就超过50万人”
- C2: scope=“被消灭的全是15英亩以下的小农场”限定农场总数净减的来源 | invariant=15英亩以上两个档位反而增加 | anchor=“15—30英亩的租地农场增加61,000家，30英亩以上的增加109,000家”
- C3: scope=“不必考察全部时期”暂不展开爱尔兰人口下降的全部历史 | invariant=1861—1865年足以观察当前论点 | anchor=“只看1861—1865年五年就够了”

## Second-read risks

- No unresolved T findings.
- S1（C2）：数字较密，但按人口、移民、住房、农场结构四层依次推进，最后一句明确解释这些数字共同说明什么。
- A1（C5—C6）：表中“增减”均相对上一年，不是相对1860年；表头已经直接写明。

## Paragraph and punctuation audit

- p0092—p0094分别对应C1—C3，p0095对应C4标题及C5、C6两张表，note-090对应C7，p0091为三级标题。
- Boundary-Changes: p0095两组源表保持分表结构，仅转为Markdown。
- Semicolons: 0
- Semicolon rationale: none.
- Translator-Notes: 0; [^181] is a source note.
- Sentence-Coverage: C1=2, C2=7, C3=4, C4=1, C5=1, C6=1, C7=1; total=17 sentences and 10 adjacent sentence pairs. Every adjacent pair in each multi-sentence block is recorded above.
