# 全书作者立场与修辞功能回扫

Rule-Version: reader-edition-v21
Adopted-Scope: audits/bookwide-authorial-stance-scope-2026-08-14.jsonl
Adopted-Scope-SHA256: 12ea87a033e985107659f33c61bdfa11f1bf395eda75070b3364f20b271afeec
Adopted-Units: 76
Adoption-Policy: 当前采用指针保持不变；修复稿只登记为待用户比较的新版本。

## Generalized defect definition

逐源段核对说话者、评价对象、态度方向、力度和功能。若批评、讽刺、嘲弄、怀疑距离、赞许、愤慨或语体变化承担了界定社会或理论立场、指出认识局限、分配责任、揭示矛盾、削弱对手观点或形成论证对照的作用，翻译不得把它删去、中性化、心理化、改换对象或无依据增强。判断以源文功能为准，不以情绪词命中为准。

## Scan batches

- [COMPLETED] ch01-s01—ch01-s04 -> audits/stance-scan-ch01-2026-08-14.md
- [COMPLETED] ch02-s01—ch03-s03 -> audits/stance-scan-ch02-ch03-2026-08-14.md
- [COMPLETED] ch04-s01—ch06-s01 -> audits/stance-scan-ch04-ch06-2026-08-14.md
- [COMPLETED] ch07-s01—ch08-s02 -> audits/stance-scan-ch07-ch08s02-2026-08-14.md
- [COMPLETED] ch08-s03—ch08-s07 -> audits/stance-scan-ch08s03-ch08s07-2026-08-14.md
- [COMPLETED] ch09-s01—ch10-s01 -> audits/stance-scan-ch09-ch10-2026-08-14.md
- [COMPLETED] ch11-s01—ch12-s05 -> audits/stance-scan-ch11-ch12-2026-08-14.md
- [COMPLETED] ch13-s01—ch13-s05 -> audits/stance-scan-ch13s01-ch13s05-2026-08-14.md
- [COMPLETED] ch13-s06—ch13-s10 -> audits/stance-scan-ch13s06-ch13s10-2026-08-14.md
- [COMPLETED] ch14-s01—ch16-s01、fm01—fm04 -> audits/stance-scan-ch14-ch16-frontmatter-2026-08-14.md
- [COMPLETED] ch17-s01—ch21-s01 -> audits/stance-scan-ch17-ch21-2026-08-14.md
- [COMPLETED] ch22-s01—ch23-s04 -> audits/stance-scan-ch22-ch23s04-2026-08-14.md
- [COMPLETED] ch23-s05 -> audits/stance-scan-ch23s05-2026-08-14.md
- [COMPLETED] ch24-s01—ch25-s01 -> audits/stance-scan-ch24-ch25-2026-08-14.md

全书 76 个 adopted unit 已按锁定范围完整覆盖。

## Candidate pipeline

1. 汇总各批 `Recall-Tasks`，去重并绑定触发问题的 adopted version。
2. 由控制器按 reader-edition-v21 为每个确认问题的任务创建新 revision；历史预算仅在本次明确召回时重置一次。
3. 每个新任务重新翻译整个任务包，不只替换命中的一句；意义审核逐源段填写立场与修辞功能，随后执行中文盲审。
4. 组装受影响单元，执行独立读者审核，登记新版本。
5. 不运行 adopt-version，不重建已采用正文，不触发语音失效；任务站仅增加可比较的新版本。

## Confirmed blocking recalls

本轮共确认并重译 22 个阻断任务，影响 16 个候选单元。扫描报告中另列出的 S 仅作编辑建议，不触发本轮返工。

- ch01-p0011-p0015-r11；ch01s03-p0041-p0045-r2
- ch03s02-p0001-p0005-r1
- ch04s01-p0011-p0015-r2；ch04s01-p0021-p0025-r2
- ch04s02-p0001-p0005-r1；ch04s02-p0011-p0015-r1
- ch04s03-p0001-p0005-r1；ch04s03-p0016-p0020-r1
- ch05-p0001-p0005-r6
- ch07s01-p0011-p0015-r1；ch07s01-p0016-p0020-r1
- ch08s04-p0006-p0010-r4
- ch11-p0017-p0020-r2；ch12s02-p0001-p0004-r3
- ch13s03-p0006-p0010-r4；ch13s03-p0026-p0030-r4
- fm01-p0006-p0010-r1
- ch22s03-p0001-p0005-r1；ch22s03-p0006-p0010-r1
- ch22s05-p0001-p0002-r1
- ch23s04-p0006-p0010-r3

Status: 22 个召回任务已按新规则重译并通过意义、可读性双审；16 个单元候选稿已全部通过独立中文盲审，并登记为待用户比较的新版本。未运行 `adopt-version`，采用指针未改变。

## Registered candidate versions

- ch01-s01-v11；ch01-s03-v4；ch03-s02-v2
- ch04-s01-v3；ch04-s02-v2；ch04-s03-v2
- ch05-s01-v7；ch07-s01-v2；ch08-s04-v3
- ch11-s01-v2；ch12-s02-v2；ch13-s03-v3
- fm01-v2；ch22-s03-v2；ch22-s05-v2；ch23-s04-v3

以上版本均已通过与其候选稿哈希绑定的独立中文盲审，仅供用户比较；本轮未采用其中任何版本。
