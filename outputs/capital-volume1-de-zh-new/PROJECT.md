# 《资本论》第一卷现代汉语通俗读者版

本项目从可靠的德文文本出发，制作一套面向普通读者的现代汉语通俗新译。
目标读者不需要预先学过经济学、哲学或马克思主义术语。

最终公开成果位于 `reader-edition/`，每章一个 Markdown 文件。原文、版本
核对、任务包、草稿、校对和决策记录全部留在后台，不进入读者正文。

翻译忠实于德文的核心命题、逻辑关系、必要概念区别和论证性证据，不追
求词语、句法或局部顺序相似。默认写成最短、最直接的自然中文；词类转
换、把抽象名词改成动作、重组句子、显化原文蕴含的中间步骤、压缩无论
证作用的重复都属于正常翻译。段落默认沿用原文；只有句内改写仍不能排
除首次阅读障碍时才拆分或合并。不得替原文补证明、提前展开后文，或改
变核心命题、关系、概念、事实、数字和引文。

审核只拦截会造成误解的实质性问题。较短、较顺或不同措辞只作为非阻断
建议。根据小节长度，一个任务或候选版本最多打回修改二至四次；达到预
算后仍有实质性问题时停止自动修改。若独立终审仍有实质性问题，则把最
终候选登记为待复核版本，附上问题摘要并继续后续单元；通过终审的版本
不显示问题摘要。

任何新任务或上下文压缩后，先运行：

```powershell
& 'C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe' skill-snapshot/reader-edition-v21/scripts/reader_project_controller.py validate .
& 'C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe' skill-snapshot/reader-edition-v21/scripts/reader_project_controller.py context .
```

在 Codex Desktop 中先读取工作区依赖，并使用其中返回的 Python。不要回退
到 `AppData\Local\Programs\Python`；后者位于工作区运行时之外，会重复触发
命令批准，即使用户已经为项目选择完全访问。

当前阶段：读者版规范已锁定；已登记 79 章的来源。
