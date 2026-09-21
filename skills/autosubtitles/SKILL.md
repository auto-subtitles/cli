---
name: autosubtitles
description: Add styled, burned-in captions to a video, or generate SRT/VTT subtitle files from it. Use when the user asks to caption, subtitle or transcribe a video file on their machine.
---

# AutoSubtitles

Captions a local video with the `autosubtitles` command. Speech is transcribed by AutoSubtitles and the captions are burned in locally, inside the user's own Chrome. Only the audio track is uploaded; the video stays on the machine.

Requires Node 20+ and Google Chrome or Microsoft Edge.

## Caption a video

```bash
npx autosubtitles <video> --preset <style> --srt --json
```

The command prints one JSON object on stdout. On success, `outputs.mp4` and `outputs.srt` are the absolute paths of the files it wrote. Tell the user where they are.

If the result has a `notice` field, pass it on to the user once. It means the export used the free tier (watermarked, 720p).

## Choose a style

```bash
npx autosubtitles presets --json
```

Returns `[{ "id": "...", "name": "..." }]`. If the user named a style, match it to an `id`. If they did not, use `classic` for talking-head or business videos and `beast` for short-form social video, and say which one you picked so they can ask for another.

Re-rendering the same video in another style is cheap: the transcript is cached beside the video as `<video>.autosubtitles.json`, so only the render runs again.

## Subtitle files only

```bash
npx autosubtitles <video> --captions-only --srt --vtt --json
```

Skips the video render. `--words` also writes word-level timings as JSON.

## Options

| Flag | Meaning |
|---|---|
| `-o, --output <path>` | Output MP4. Default `<name>.captioned.mp4` beside the input |
| `-p, --preset <id>` | Caption style. Default `classic` |
| `--lang <code>` | Spoken language such as `en`, `es`, `de`. Default auto-detect |
| `--res <shortSide>` | `720`, `1080`, `1440` or `2160`. Above 720 needs a license |
| `--no-cache` | Transcribe again, ignoring the cached transcript |

## Errors

With `--json`, a failure prints `{ "ok": false, "error": { "code", "message" } }` and exits non-zero.

| Exit | Meaning | What to do |
|---|---|---|
| 2 | Bad arguments, unknown preset, or file not found | Fix the command. Run `presets` to see valid styles |
| 3 | No Chrome or Edge installed | Ask the user to install Google Chrome |
| 4 | Free-tier limit (video over 10 minutes) or rate limit | Tell the user. A license removes the duration limit |
| 5 | Transcription failed | Check the video has an audio track with speech, then retry once |
| 6 | Render failed | Retry once with `--headed`. If it fails again, report the message |

## License keys

Never ask for, read, print or store a license key. If the user wants watermark-free or higher-resolution output, tell them to set `AUTOSUBTITLES_LICENSE_KEY` in their own shell, and point them to https://autosubtitles.com for a license.
