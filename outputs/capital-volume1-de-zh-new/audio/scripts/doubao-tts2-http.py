#!/usr/bin/env python3
"""Generate an experimental Doubao Seed-TTS 2.0 sample over HTTP Chunked.

The output belongs to audio/voice-tests only. This script doesn't register the
sample as a formal audio version or change the adopted narration.
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import uuid
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


ENDPOINT = "https://openspeech.bytedance.com/api/v3/tts/unidirectional"


def decode_json_stream(body: bytes) -> list[dict[str, Any]]:
    """Decode one or more adjacent/line-delimited JSON response objects."""
    text = body.decode("utf-8-sig")
    decoder = json.JSONDecoder()
    responses: list[dict[str, Any]] = []
    offset = 0
    while offset < len(text):
        while offset < len(text) and text[offset].isspace():
            offset += 1
        if offset >= len(text):
            break
        value, offset = decoder.raw_decode(text, offset)
        if not isinstance(value, dict):
            raise ValueError("The TTS response contained a non-object JSON value")
        responses.append(value)
    if not responses:
        raise ValueError("The TTS response body was empty")
    return responses


def request_audio(
    args: argparse.Namespace,
    text: str,
    prompt: str,
    api_key: str,
) -> tuple[bytes, dict[str, Any]]:
    request_id = str(uuid.uuid4())
    req_params: dict[str, Any] = {
        "text": text,
        "model": args.model,
        "speaker": args.speaker,
        "audio_params": {
            "format": "mp3",
            "sample_rate": args.sample_rate,
            "bit_rate": args.bit_rate,
            "speech_rate": args.speech_rate,
            "loudness_rate": args.loudness_rate,
            "enable_subtitle": True,
        },
        "additions": json.dumps(
            {
                "disable_markdown_filter": True,
                "disable_emoji_filter": True,
                "explicit_language": "zh-cn",
            },
            ensure_ascii=False,
        ),
    }
    if prompt:
        req_params["context_texts"] = [prompt]

    request = Request(
        args.endpoint,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "Connection": "keep-alive",
            "X-Api-Key": api_key,
            "X-Api-Resource-Id": args.resource_id,
            "X-Api-Request-Id": request_id,
            "X-Control-Require-Usage-Tokens-Return": "*",
        },
        data=json.dumps(
            {"req_params": req_params},
            ensure_ascii=False,
            separators=(",", ":"),
        ).encode("utf-8"),
    )

    try:
        with urlopen(request, timeout=300) as response:
            body = response.read()
            headers = {
                "content_type": response.headers.get("Content-Type", ""),
                "log_id": response.headers.get("X-Tt-Logid", ""),
                "request_id": response.headers.get("X-Api-Request-Id", request_id),
            }
    except HTTPError as error:
        detail = error.read().decode("utf-8", "replace")
        raise RuntimeError(f"Doubao TTS returned HTTP {error.code}: {detail}") from error
    except URLError as error:
        raise RuntimeError(f"Unable to reach Doubao TTS: {error.reason}") from error

    responses = decode_json_stream(body)
    audio_parts: list[bytes] = []
    sentences: list[dict[str, Any]] = []
    usage: dict[str, Any] = {}
    response_summary: list[dict[str, Any]] = []
    for item in responses:
        code = int(item.get("code", 0))
        if code not in (0, 20_000_000):
            raise RuntimeError(
                f"Doubao TTS returned code {code}: {item.get('message', 'unknown error')}"
            )
        encoded_audio = item.get("data")
        if encoded_audio:
            audio_parts.append(base64.b64decode(encoded_audio))
        sentence = item.get("sentence")
        if isinstance(sentence, dict) and sentence:
            sentences.append(sentence)
        if isinstance(item.get("usage"), dict):
            usage.update(item["usage"])
        response_summary.append(
            {
                "code": code,
                "message": item.get("message", ""),
                "audio_bytes": len(audio_parts[-1]) if encoded_audio else 0,
                "sentence": sentence,
                "usage": item.get("usage"),
            }
        )

    audio = b"".join(audio_parts)
    if not audio:
        raise RuntimeError(
            "Doubao TTS completed without audio data: "
            + json.dumps(response_summary, ensure_ascii=False)
        )
    return audio, {
        "request": {
            "request_id": request_id,
            "endpoint": args.endpoint,
            "resource_id": args.resource_id,
            "model": args.model,
            "speaker": args.speaker,
            "audio_params": req_params["audio_params"],
            "used_context_texts": bool(prompt),
        },
        "response_headers": headers,
        "response_count": len(responses),
        "sentences": sentences,
        "usage": usage,
        "responses": response_summary,
    }


def parse_args() -> argparse.Namespace:
    script = Path(__file__).resolve()
    project_root = script.parents[2]
    repo_root = project_root.parents[1]
    parser = argparse.ArgumentParser()
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--source-metadata", type=Path)
    source.add_argument("--text-file", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--sentence-limit", type=int, default=0)
    parser.add_argument(
        "--api-key-file",
        type=Path,
        default=repo_root / "keys" / "volcengine-api-key.txt",
    )
    parser.add_argument(
        "--config",
        type=Path,
        default=project_root / "audio" / "config.json",
    )
    parser.add_argument("--endpoint", default=ENDPOINT)
    parser.add_argument("--resource-id", default="seed-tts-2.0")
    parser.add_argument("--model", default="seed-tts-2.0-standard")
    parser.add_argument("--speaker", default="")
    parser.add_argument("--sample-rate", type=int, default=48000)
    parser.add_argument("--bit-rate", type=int, default=128000)
    parser.add_argument("--speech-rate", type=int, default=0)
    parser.add_argument("--loudness-rate", type=int, default=0)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    config = json.loads(args.config.read_text(encoding="utf-8"))
    if args.source_metadata:
        source = json.loads(args.source_metadata.read_text(encoding="utf-8"))
        sentences = source["sentences"]
        if args.sentence_limit > 0:
            sentences = sentences[: args.sentence_limit]
        text = "".join(sentence["text"] for sentence in sentences)
        source_metadata = str(args.source_metadata.resolve())
    else:
        text = args.text_file.read_text(encoding="utf-8-sig").strip()
        source_metadata = None
    args.speaker = args.speaker or config["speaker"]
    api_key = args.api_key_file.read_text(encoding="utf-8-sig").strip()
    if not api_key:
        raise RuntimeError("The API key file is empty")

    audio, provider_metadata = request_audio(
        args,
        text,
        config.get("prompt", ""),
        api_key,
    )
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_bytes(audio)
    metadata = {
        "schema_version": 1,
        "purpose": "seed-tts-2.0-http-comparison",
        "source_metadata": source_metadata,
        "source_text": text,
        "source_text_sha256": hashlib.sha256(text.encode("utf-8")).hexdigest(),
        "output_file": args.output.name,
        "output_bytes": len(audio),
        "output_sha256": hashlib.sha256(audio).hexdigest(),
        **provider_metadata,
    }
    sidecar = args.output.with_suffix(".json")
    sidecar.write_text(
        json.dumps(metadata, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(
        json.dumps(
            {
                "audio": str(args.output),
                "metadata": str(sidecar),
                "bytes": len(audio),
                "usage": provider_metadata["usage"],
            },
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
