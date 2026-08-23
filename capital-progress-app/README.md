# 《资本论》通俗新译本地工作台

这是一个只在本机运行的翻译目录与阅读工具。

- 不使用云端服务、远程数据库、账号或同步密钥。
- 翻译项目目录是唯一事实来源。
- 页面每 5 秒读取全书目录、章节状态、版本和译文。
- 正文可以切换预览不同版本；“采用”只更新本地标记，不会删除旧版本。
- 已采用的译文可以选择不同语音模型生成多个语音版本，试听后再单独采用其中一个。
- 关闭网页或重启电脑不会丢失状态；所有持久内容都保存在翻译项目目录中。

## 启动

双击 `启动翻译工作台.cmd`。

启动后浏览器会打开：

```text
http://127.0.0.1:4173
```

终端窗口必须保持打开。关闭它即可停止工作台。

## 命令行启动

```powershell
npm start
```

默认读取相邻目录：

```text
../outputs/capital-volume1-de-zh-new
```

若项目移动到了别处，可先设置 `CAPITAL_PROJECT_ROOT`：

```powershell
$env:CAPITAL_PROJECT_ROOT = "D:\path\to\capital-project"
npm start
```

## 本地数据

正式状态和内容位于翻译项目中：

- `manifests/outline.json`：第一卷 7 篇、25 章的完整计划；
- `manifests/work-units.jsonl`：已进入工程的章节或小节；
- `manifests/` 中的其他文件：章节、任务与版本状态；
- `manifests/unit-versions.jsonl`：可预览的不可变版本；
- `manifests/adoptions.json`：当前采用的版本；
- `chapters/`：原文、任务包、草稿和审校；
- `progress/events.jsonl`：进展事件；
- `reader-edition/`：组章后的读者版 Markdown。
- `audio/models.json`：可用语音模型；
- `audio/index.json`：所有生成过的语音版本；
- `audio/adoptions.json`：每个译文当前采用的语音版本。

`data/progress.json` 只是构建或检查时生成的本地快照，不是事实来源。

## 语音生成与发布

每个已采用的译文版本都可以在工作台中：

1. 选择语音模型，先查看可复用分块、新生成分块和待生成字数；
2. 明确确认后才生成独立的语音版本；工作台同一时间只允许一个语音任务，不接受后台排队；
3. 试听后采用其中一个语音版本；
4. 将当前采用的语音上传到线上预览站。

上传采用逐文件校验和断点续传。语音文件先上传，最后才更新线上采用清单；只有译文版本、译文哈希和语音采用记录完全一致时，线上阅读器才会启用语音。发布状态保存在 `audio/publications.json`，上传地址和密钥保存在不提交 Git 的 `.audio-publish.local.json`。
