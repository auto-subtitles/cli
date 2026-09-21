---
name: autosubtitles
description: Add styled, burned-in captions to a video. With AutoSubtitles Pro, also generate SRT/VTT subtitle files. Use when the user asks to caption, subtitle or transcribe a video file on their machine.
---

# AutoSubtitles

Captions a local video with the `autosubtitles` command. Speech is transcribed by AutoSubtitles and the captions are burned in locally, inside the user's own Chrome. Only the audio track is uploaded; the video stays on the machine.

Requires Node 20+ and Google Chrome or Microsoft Edge.

## Before the first render: free or Pro

Run this once per conversation, before rendering a video:

```bash
npx autosubtitles plan --json
```

If `plan` is `pro`, carry on without asking. If the command is not recognised, the installed CLI is older: run `npx autosubtitles@latest plan --json` instead.

If `plan` is `free`, tell the user the difference and ask which they want before you render:

| | Free | Pro |
|---|---|---|
| Watermark | AutoSubtitles logo on the video | None |
| Resolution | Up to 720p | Up to 4K |
| Video length | Up to 10 minutes | No limit |
| Subtitle files (SRT, VTT, word timings) | No | Yes |

- **Free:** render straight away.
- **Pro:** they get a license at https://autosubtitles.com, set `AUTOSUBTITLES_LICENSE_KEY` in their own shell, and start a new session so you can see it. Then run `plan` again.

If `reason` is `invalid_key`, `inactive` or `payment_failed`, say that a key is set but is not active, and ask the same question.

Skip the question when the user has already chosen. If the plan is `free` and they only want subtitle files, or the video is longer than 10 minutes, do not run the command: tell them that needs Pro.

## Caption a video

```bash
npx autosubtitles <video> --preset <style> --json
```

The command prints one JSON object on stdout. On success, `outputs.mp4` is the absolute path of the captioned video. Tell the user where it is.

On Pro, add `--srt` or `--vtt` when the user wants subtitle files too; their paths appear in `outputs`. On the free plan those are not written and are listed in `skipped`.

## Choose a style

```bash
npx autosubtitles presets --json
```

Returns `[{ "id": "...", "name": "..." }]`. If the user named a style, match it to an `id`. If they did not, use `classic` for talking-head or business videos and `beast` for short-form social video, and say which one you picked so they can ask for another.

Re-rendering the same video in another style is cheap: the transcript is cached on the user's machine, so only the render runs again.

## Subtitle files only (Pro)

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
| 4 | Needs Pro (subtitle files only, or a video over 10 minutes), or a rate limit | Tell the user what Pro adds. Do not retry |
| 5 | Transcription failed | Check the video has an audio track with speech, then retry once |
| 6 | Render failed | Retry once with `--headed`. If it fails again, report the message |

## License keys

Never ask for, read, print or store a license key. If the user wants watermark-free or higher-resolution output, tell them to set `AUTOSUBTITLES_LICENSE_KEY` in their own shell, and point them to https://autosubtitles.com for a license.
