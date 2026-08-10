# 语音阅读工作流

语音只属于某一份确定的译文。每个语音版本同时记录翻译单元、采用版本和译文文件的 SHA-256；三项必须全部一致，预览站才会发布它。采用新译文后，旧语音会保留在历史记录中，但不会继续播放。

## 状态文件

- `models.json`：可选语音模型及各自的音色、格式和分块参数。
- `config.json`：旧版单模型配置，保留用于向后兼容。
- `index.json`：所有语音版本与最近生成任务的摘要。
- `adoptions.json`：每个译文版本当前采用的语音版本。
- `versions/<audio-version-id>/manifest.json`：不可变的语音清单，记录逐句时间和音频块。
- `jobs.jsonl`：生成过程的追加式事件日志。

## 生成

在仓库根目录运行：

```powershell
node outputs/capital-volume1-de-zh-new/audio/scripts/audio-controller.mjs generate --unit ch07-s04 --model seed-tts-2.0
```

控制器只为当前采用的译文生成语音。同一译文可以分别生成 `seed-audio-1.0` 和 `seed-tts-2.0`，各自形成独立语音版本，互不覆盖。新版本生成完成后不会自动替换当前语音，需在本地工作台试听并采用。

控制器会先核对译文哈希，再按短音频块生成。采用新的译文版本后，如果同一模型和音色已有上一版语音，控制器会逐块比较句子编号、显示文字和实际朗读文字：完全未变的块直接复用，只有包含改动的块会重新调用语音接口。新语音仍形成独立版本，并严格绑定新的译文版本和哈希，旧录音不会被错误地当作新译文播放。API 密钥从环境变量 `VOLCENGINE_API_KEY_FILE` 指向的文件读取；未设置时使用仓库本地的 `keys/volcengine-api-key.txt`。密钥不写入任何项目文件。

`status` 查看状态，`validate` 检查所有 ready 语音是否仍能通过版本、哈希、文件和逐句映射校验。
