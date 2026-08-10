Review-Type: readability
Task-ID: ch23s05-p0096-p0100-r1
Source-Blind: YES
Draft-SHA256: 00e6604e3e6621bfd69e32605764c3a912228aae78f4e1a349846e3e4607c5ba
Verdict: PASS

## One-read paraphrases

- C1: 下一小表汇总四类牲畜五年的净变化。
- C2: 马和牛减少，绵羊和猪增加。
- C3: 下面考察种植业，并说明表内增减基准及作物分类。
- C4: 表B统计各类农牧用地面积增减。
- C5: 1861—1865年谷物和绿色作物面积净减，草地苜蓿和亚麻净增，农牧用地总量净减。
- C6: 1865年草地面积增加，但谷物和马铃薯产量下降，马铃薯甚至在种植面积扩大时减产。
- C7: 下面转向阶级收入，并先解释收入税表中D、C、E类包括哪些收入。
- C8: 把基期前移后，绵羊和猪也比早期数量少。

## Reader questions

- C1 Q: 净变化覆盖哪几年？ A: 1860—1865年。
- C2 Q: 哪两类牲畜净减少？ A: 马和牛。
- C3 Q: 表B每年的增减同哪一年比较？ A: 紧邻的前一年。
- C4 Q: 表B的面积单位是什么？ A: 英亩。
- C5 Q: 五年农牧用地合计怎样变化？ A: 净减少330,370英亩。
- C6 Q: 马铃薯数据的反差是什么？ A: 种植面积扩大，产量却减少446,398吨。
- C7 Q: D类是否包括租地农场主利润？ A: 不包括，但包括律师、医生等专业收入。
- C8 Q: 为什么说更早比较结果更不利？ A: 1865年的绵羊和猪都少于所列更早年份。

## Transition evidence

- C1: 单句，引出牲畜净变化表。
- C2: 单一表格，无相邻句对。
- C3: S1->S2=先从牲畜转到种植业，再说明逐年比较基准，signal=“下一张表”；S2->S3=比较基准后定义谷物范围，signal=“谷物包括”；S3->S4=谷物后定义绿色作物范围，signal=“绿色作物包括”。
- C4: 单句，给出表B主题和单位。
- C5: 单一表格，无相邻句对。
- C6: S1->S2=先解释草地面积增加来源，再转到1865与1864产量比较，signal=“再把”；S2->S3=谷物总减产后列小麦、燕麦、大麦分项，signal=“其中”；S3->S4=谷物后转到马铃薯面积增而产量减的反差，signal=“虽然……却”；S4->S5=列完产量变化后引出下一表，signal=“下一张表”。
- C7: S1->S2=先从人口生产转到阶级钱袋，再说明收入税能反映变化，signal=“会反映”；S2->S3=指出指标后说明读表前须解释分类，signal=“为了读懂”；S3->S4=提出分类后先解释D类，signal=“D类”；S4->S5=D类后解释未另列细目的C/E类，signal=“则包括”。
- C8: S1->S2=先说前移起点结果更差，再给绵羊早年比较，signal=具体数字；S2->S3=绵羊后给猪的同类比较，signal=“有猪”。

## Scope and closure audit

- C3: scope=“每一年的增加或减少”限定逐年数字 | invariant=比较对象始终是紧邻前一年 | anchor=“都是同前一年相比”
- C6: scope=“主要是因为”不把全部草地增量都归于荒地沼泽减少 | invariant=101,543英亩是127,470英亩增量的主要来源 | anchor=“未利用荒地和泥炭沼泽”减少了101,543英亩
- C7: scope=D类“租地农场主利润以外”排除农业租地利润 | invariant=D类仍含其他利润和专业收入 | anchor=“也包括律师、医生等所谓“专业收入””
- C8: scope=“把比较起点再往前推”改变绵羊和猪的基期 | invariant=较长时期下1865年数量低于早期 | anchor=“结果会更不利”

## Second-read risks

- No unresolved T findings.
- S1（C5）：表B列数很多，但列名完整写出对象和增减方向，累计行使五年结论无需读者自行相加。
- A1（C6）：草地面积增加不等于畜产量必然增加；正文只陈述统计事实，没有添加因果推论。

## Paragraph and punctuation audit

- p0096对应C1和C2，p0097对应C3，p0098对应C4和C5，p0099、p0100对应C6、C7，note-091对应C8。
- Boundary-Changes: 两个源表转为Markdown并展开多层表头，数据和分组保持不变。
- Semicolons: 0
- Semicolon rationale: none.
- Translator-Notes: 0; [^182] is a source note.
- Sentence-Coverage: C1=1, C2=1, C3=4, C4=1, C5=1, C6=5, C7=5, C8=3; total=21 sentences and 14 adjacent sentence pairs. Every adjacent pair in each multi-sentence block is recorded above.
