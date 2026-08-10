Review-Type: readability
Task-ID: ch23s05-p0066-p0070-r1
Source-Blind: YES
Draft-SHA256: 327c25be0d1a7d563621f504a9e9e714a84bed83d79b3aa71e0916b726278be8
Verdict: PASS

## One-read paraphrases

- C1: 埃塞克斯至少22个教区拆掉大量住房后，人口不降反升，居民只得在越来越少的房屋里挤住。
- C2: 赫里福德驱逐严重，马德利的租地农场主一面付给工人低工资，一面把拥挤小屋高价租给他们。

## Reader questions

- C1 Q: 五教区的合计数字证明了什么？ A: 同一土地上，十年间住房减少67所，人口却增加81人。
- C2 Q: 马德利的小屋和工资由谁同时掌握？ A: 许多租地农场主既雇用工人，又把小屋租给他们。

## Transition evidence

- C1: S1->S2=先说人口与住房共同减少的常见情况，再转到至少22个教区人口未被拆房赶走的相反情况，signal=“不过……另一种情况”；S2->S3=概括住房减少人口增加后给芬格林霍实例，signal=地名和具体数字；S3->S4=第一个教区后列拉姆斯登克雷斯，继续同类证据，signal=新地名；S4->S5=第二个教区后列巴西尔登，继续同类证据，signal=新地名；S5->S6=三个实例后转到五教区总体，signal=“合计来看”；S6->S7=先给合计面积和对象，再用1851与1861的总数作同地比较，signal=两个年份。
- C2: S1->S2=先说赫里福德驱逐最严重，再以马德利小屋说明具体住房状态和所有者，signal=“在马德利”；S2->S3=确认租地农场主持有小屋后，说明他们高价出租却只付低工资，signal=“他们……却”。

## Scope and closure audit

- C1: scope=“许多教区”不把人口与住房共同减少概括为全郡所有教区 | invariant=另有至少22个教区出现人口增长而住房减少 | anchor=“至少有22个教区出现了另一种情况”
- C1: scope=“既没能阻止……也没能把”列出拆房没有实现的两种结果 | invariant=居民留下后住房拥挤加重 | anchor=“于是留下来的人只能挤得更紧”
- C1: scope=“只剩110所”限定芬格林霍1861年的住房数量 | invariant=人口在同一时期反而增加 | anchor=“但人口不但没有离开，反而增加了”
- C1: scope=“不但没有离开，反而增加”排除拆房必然导致人口下降 | invariant=芬格林霍人口在住房减少时仍增长 | anchor=“反而增加了”
- C2: scope=“大多只有两间卧室”说明马德利多数受述小屋的卧室上限 | invariant=这些小屋仍然拥挤且许多归租地农场主 | anchor=“拥挤的小屋大多只有两间卧室，许多属于租地农场主”

## Second-read risks

- No unresolved T findings.
- S1（C1）：地名和数字密集，但先分别举三例、再给五区合计的结构明确，读者不需自行推导材料层次。
- A1（C1）：首句说许多教区人口也减少，第二句则说明另一些教区人口增长；“不过”和“另一种情况”已经明确两组对象不同。

## Paragraph and punctuation audit

- p0067和p0069各对应一个正文段，p0066、p0068、p0070分别对应地区标题，没有改变源文正文段界。
- Boundary-Changes: none.
- Semicolons: 1
- Semicolon rationale: C1末句用分号隔开1851和1861两组五教区总计数据，使比较基准一眼可见。
- Translator-Notes: 0
- Sentence-Coverage: C1=7, C2=3; total=10 sentences and 8 adjacent sentence pairs. Every adjacent pair in each multi-sentence block is recorded above.
