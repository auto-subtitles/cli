# autosubtitles

Add styled, burned-in captions to a video from the command line, or let your AI agent do it.

```bash
npx autosubtitles talk.mp4 --preset beast
```

```
/Users/you/talk.captioned.mp4
```

The video is rendered **locally, inside your own Chrome**, using the same renderer as the [AutoSubtitles](https://autosubtitles.com) web editor. Only the audio track is uploaded, for transcription. The video never leaves your machine.

- 28 caption styles, including word-by-word highlighting and animated styles
- Hardware-accelerated: a 60-second 1080p clip renders in about 8 seconds on an Apple M-series Mac
- No ffmpeg, no Python, no model downloads. Needs Node 20+ and Google Chrome or Microsoft Edge
- Free to use with a watermark. [AutoSubtitles Pro](https://autosubtitles.com) removes it and adds SRT, VTT and word-level JSON files

## Use it from an AI agent

This repository includes an [agent skill](skills/autosubtitles/SKILL.md). It works with Claude Code, Codex, Cursor, Gemini CLI and any agent that can run a shell command.

```bash
npx skills add auto-subtitles/cli
```

Then ask in your own words:

> Caption demo.mp4 in the Karaoke style.

What the skill gives your agent:

| | |
|---|---|
| **caption** | Burn captions in, in the style you name |
| **restyle** | The same video in another style, in seconds |
| **live** | A window where you pick a style, check the captions, and ask your agent for changes while you watch |
| **review** | The same window without the conversation: pick, click Render |
| **subtitles** (Pro) | SRT, VTT and word-timing files |
| **styles**, **plan** | List the styles; see what Free and Pro allow |

Name a style and it just renders. Leave the style open and a small window appears so you can choose by eye.

Not installing the skill? Name the command so your agent knows where to find it:

> Use `npx autosubtitles` to caption demo.mp4 in the Karaoke style.

With `--json` the command prints a single JSON object, so agents can read the result without parsing text:

```json
{
  "ok": true,
  "outputs": { "mp4": "/Users/you/demo.captioned.mp4" },
  "durationSeconds": 60,
  "captionCount": 32,
  "seconds": 8.3,
  "preset": "Karaoke",
  "watermark": true,
  "maxShortSide": 720
}
```

More for agents and developers: [autosubtitles.com/agent](https://autosubtitles.com/agent)

## Usage

```
autosubtitles <video> [options]     caption a video
autosubtitles review <video>        pick a style (and check captions) in a small window, then render
autosubtitles presets [--json]      list caption styles
autosubtitles plan [--json]         show whether you are on Free or Pro

  -o, --output <path>     output MP4 (default: <name>.captioned.mp4)
  -p, --preset <name>     caption style (default: classic)
      --lang <code>       spoken language, e.g. en, es, de (default: auto-detect)
      --res <shortSide>   720, 1080, 1440 or 2160 (above 720 needs Pro)
      --srt --vtt --words also write subtitle files beside the output (Pro)
      --captions-only     write subtitle files only, skip the video (Pro)
      --no-cache          transcribe again even if a cached transcript exists
      --json              print one JSON result on stdout
      --headed            show the browser window
      --browser <name>    chrome, msedge or chromium
```

### Pick a style by eye

```bash
npx autosubtitles review talk.mp4
```

A small window opens with your video and every style. Click through them and watch the captions change, then click **Render video**. "Check captions first" lets you fix the wording and timings before it renders.

Through an agent the same window becomes a conversation. There is a box at the bottom: type "make the captions bigger and yellow" or "fix the speaker's name everywhere", and your agent changes it while you watch. This is what happens when you ask an agent to caption a video without naming a style.

Agents drive it with four commands: `review <video> --live` opens the window and returns at once, `poll` waits for what you do next, `reply` applies changes (`--preset`, `--set key=value`, `--replace "find=>with"`, `--message`), and `close` ends it. The skill's [live reference](skills/autosubtitles/reference/live.md) has the details.

### Try a few styles from the command line

The transcript is cached on your machine (in your system cache folder, never beside your video), so only the first run transcribes. Re-rendering in another style takes seconds:

```bash
npx autosubtitles talk.mp4 -p classic  -o talk.classic.mp4
npx autosubtitles talk.mp4 -p karaoke  -o talk.karaoke.mp4
npx autosubtitles talk.mp4 -p neon-glow -o talk.neon.mp4
```

Want a style that is not in the list? Design it in the [web editor](https://autosubtitles.com), where you can see it on your own video.

### Subtitle files (Pro)

```bash
npx autosubtitles talk.mp4 --captions-only --srt --vtt
```

## Free and Pro

| | Free | Pro |
|---|---|---|
| Captioned video | Yes | Yes |
| Watermark | Yes | No |
| Resolution | Up to 720p | Up to 4K |
| Video length | Up to 10 minutes | No limit |
| Subtitle files (SRT, VTT, word timings) | No | Yes |

These are the same as the web editor. To use your Pro license key:

```bash
export AUTOSUBTITLES_LICENSE_KEY=your-key
```

## How it works

1. The command launches your installed Chrome (or Edge) headlessly and opens `autosubtitles.com/render`.
2. The page extracts the audio track and sends it for transcription.
3. Captions are drawn onto each frame and re-encoded with [WebCodecs](https://developer.mozilla.org/docs/Web/API/WebCodecs_API), using your GPU's video encoder where one is available.
4. The finished MP4 is written to disk.

Because the renderer is the website's own, new styles and fixes arrive without updating this package.

## Exit codes

| Code | Meaning |
|---|---|
| 0 | Success |
| 2 | Bad arguments, unknown preset, or file not found |
| 3 | No Chrome or Edge found |
| 4 | Needs Pro, or a rate limit |
| 5 | Transcription failed |
| 6 | Render failed |
| 130 | Cancelled |

## License

MIT. The caption renderer itself is part of [AutoSubtitles](https://autosubtitles.com) and is not included in this repository.
