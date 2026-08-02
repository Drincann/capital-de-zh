# 语音阅读工作流

语音只属于某一份确定的译文。每个语音版本同时记录翻译单元、采用版本和译文文件的 SHA-256；三项必须全部一致，预览站才会发布它。采用新译文后，旧语音会保留在历史记录中，但不会继续播放。

## 状态文件

- `config.json`：正式音色、模型、音频格式和分块参数。
- `index.json`：所有语音版本与最近生成任务的摘要。
- `versions/<audio-version-id>/manifest.json`：不可变的语音清单，记录逐句时间和音频块。
- `jobs.jsonl`：生成过程的追加式事件日志。

## 生成

在仓库根目录运行：

```powershell
node outputs/capital-volume1-de-zh-new/audio/scripts/audio-controller.mjs generate --unit ch07-s04
```

控制器只为当前采用版本生成语音。它会先核对译文哈希，再按短音频块生成；重复执行会复用已经成功的音频块。API 密钥从环境变量 `VOLCENGINE_API_KEY_FILE` 指向的文件读取；未设置时使用仓库本地的 `keys/volcengine-api-key.txt`。密钥不写入任何项目文件。

`status` 查看状态，`validate` 检查所有 ready 语音是否仍能通过版本、哈希、文件和逐句映射校验。
