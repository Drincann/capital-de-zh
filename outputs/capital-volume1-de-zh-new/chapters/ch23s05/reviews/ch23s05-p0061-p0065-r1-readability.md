Review-Type: readability
Task-ID: ch23s05-p0061-p0065-r1
Source-Blind: YES
Draft-SHA256: ecebfba40af892ee039787ca14f30d2b0ea8a2ffe025ca8ae25f9950da456176
Verdict: PASS

## One-read paraphrases

- C1: 温斯洛即使建了不少好房，住房仍然紧缺到连破屋也能收取高租金。
- C2: 沃特伊顿人口增长时地主反而拆房，大家庭工人因此在工作附近租不到住房，只能远距离步行。
- C3: 廷克斯恩德居民付着相对很高的房租，却住在比苦役犯人均空间还小、缺水且门窗破败的房屋里。
- C4: 甘布林盖居民挤在不断腐烂的房屋中麻木生活，外地地主仍向他们收取高额租金。

## Reader questions

- C1 Q: 为什么破烂小屋仍能租到每周1先令以上？ A: 当地住房需求远大于供给。
- C2 Q: 工人为什么每天要走约4英里上工？ A: 工作附近的房东不肯把房子租给有一大家子的人。
- C3 Q: “天然通风”为什么带有讽刺意味？ A: 并非房屋设计良好，而是老屋破损、到处漏风。
- C4 Q: 谁从甘布林盖的破屋和高租中获利？ A: 住在外地的土地所有者。

## Transition evidence

- C1: S1->S2=先承认温斯洛有不少新建好房，再以破屋租金说明住房仍极紧缺，signal=“因为连”。
- C2: S1->S2=先说人口增加而地主拆房，再落到一个被迫远距离上工的工人，signal=具体案例；S2->S3=交代步行距离后提出为何不能近住的问题，signal=“有人问”；S3->S4=问题后先给直接否定，signal=“他回答”；S4->S5=否定后补充房东拒租的原因是家庭太大，signal=引语延续。
- C3: S1->S2=先给九人卧室，再给另一间六人卧室，signal=“另一间”；S2->S3=两个案例后归纳人均空间低于苦役犯，signal=“这两户”；S3->S4=人均空间比较后扩展到当地房屋的一室、无后门和缺水，signal=“当地”；S4->S5=住房条件后给租金范围，signal=“周租金”；S5->S6=租金后对照16所房中仅一人周薪10先令，signal=“调查的16所”；S6->S7=低工资调查后回到九人家庭，换算人均空气空间，signal=“按前面”；S7->S8=箱子比喻后以漏风的“天然通风”作反讽收束，signal=“当然……倒是”。
- C4: S1->S2=先说明村庄分属不同地主，再写小屋极破和草辫劳动，signal=“这里”；S2->S3=生活条件后概括全村的麻木与绝望，signal=“整个村庄”；S3->S4=总体精神状态后转到村中心和南北两端的房屋腐烂，signal=空间推进；S4->S5=房屋无人维护后指出外地地主仍在榨租，signal=“仍”；S5->S6=榨租判断后给高租和8—9人一室的事实，signal=“房租很高”；S6->S7=常见拥挤后再给两户6名成人带孩子的实例，signal=“还有两户”。

## Scope and closure audit

- C1: scope=“连十分破烂的小屋”取住房质量最低端作证据 | invariant=即便质量很差也能收到1先令或1先令3便士的周租 | anchor=“每周也能租到1先令或1先令3便士”
- C3: scope=“最高处也只有6英尺5英寸”把高度限制在屋顶最高点 | invariant=整间卧室并没有更高的可用部分 | anchor=“最高处也只有6英尺5英寸”
- C3: scope=“只有一个男人每周能挣到10先令”把较高工资者限制为16所房中的一人 | invariant=其余受查男子周薪低于这一数额 | anchor=“调查的16所房子里，只有一个男人每周能挣到10先令”
- C3: scope=“只相当于”限定九人家庭的人均空气空间 | invariant=比较基准是长宽高各4英尺的封闭箱子 | anchor=“夜里被关在一个长、宽、高各4英尺的箱子里”

## Second-read risks

- No unresolved T findings.
- S1（C2）：引语被机械分句工具拆成两句，但问答对象和因果指代清楚。
- A1（C3）：四英尺见方的箱子是原材料用来说明空气体积的比喻，不表示居民实际睡在箱子里；正文由“只相当于”明确比较关系。

## Paragraph and punctuation audit

- p0061、p0062、p0063、p0065各对应一个正文段，p0064对应地区标题，没有改变源文正文段界。
- Boundary-Changes: none.
- Semicolons: 0
- Semicolon rationale: none; all source semicolon chains were rewritten as separate Chinese sentences or comma-linked compact lists.
- Translator-Notes: 0
- Sentence-Coverage: C1=2, C2=5, C3=8, C4=7; total=22 sentences and 18 adjacent sentence pairs. Every adjacent pair in each multi-sentence block is recorded above.
