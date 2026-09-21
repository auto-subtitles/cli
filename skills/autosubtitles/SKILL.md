---
name: autosubtitles
description: Add styled, burned-in captions to a video. With AutoSubtitles Pro, also generate SRT/VTT subtitle files. Use when the user asks to caption, subtitle or transcribe a video file on their machine.
---

# AutoSubtitles

Captions a local video with the `autosubtitles` command. Speech is transcribed by AutoSubtitles and the captions are burned in locally, inside the user's own Chrome. Only the audio track is uploaded; the video stays on the machine.

Requires Node 20+ and Google Chrome or Microsoft Edge.

## Before the first render: free or Pro

Run this once per conversation, before rendering a video or opening the review window:

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

## Choose how to run it

| The user… | Do this |
|---|---|
| named a style, and did not ask to check anything | Render directly (below) |
| did not name a style, or wants to see the styles or check the captions | Open the review window |
| is not at the computer: a background job, a batch of files, a scheduled run | Never open a window. Pick a style yourself and render directly |

## Review window

```bash
npx autosubtitles review <video> --json
```

A small window opens on the user's screen: their video with the captions on it, and every style to click through. "Check captions first" shows the captions as editable lines, with timings. They click **Render video** or **Cancel**, the window closes itself, and the command prints one JSON object. Tell the user the window has opened, then wait for the command to finish.

- Add `--preset <style>` to open with a style already applied.
- Add `--captions` when the user wants to check or fix the captions, to open straight at that step.
- `action` in the result is `render` (with `outputs.mp4`, the `preset` they chose, and `edited`: whether they changed any captions), `cancel`, or `timeout`.
- `timeout` means nobody touched the window for 10 minutes. Nothing was rendered. Ask whether they want to try again; do not reopen it unasked.

## Render directly

```bash
npx autosubtitles <video> --preset <style> --json
```

The command prints one JSON object on stdout. On success, `outputs.mp4` is the absolute path of the captioned video. Tell the user where it is.

On Pro, add `--srt` or `--vtt` when the user wants subtitle files too; their paths appear in `outputs`. On the free plan those are not written and are listed in `skipped`.

Styles, for when you have to choose one yourself:

```bash
npx autosubtitles presets --json
```

Returns `[{ "id": "...", "name": "..." }]`. If the user named a style, match it to an `id`. If you must choose, use `classic` for talking-head or business videos and `beast` for short-form social video, and say which one you picked.

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
