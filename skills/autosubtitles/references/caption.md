# caption, restyle, styles

Render directly, with no window. Use when the user named a style, or when nobody is at the computer.

```bash
npx autosubtitles <video> --preset <style> --json
```

On success `outputs.mp4` is the absolute path of the captioned video, written beside the input as `<name>.captioned.mp4`. Tell the user where it is, and which style you used if you chose it.

| Flag | Meaning |
|---|---|
| `-o, --output <path>` | Output MP4 |
| `-p, --preset <id>` | Caption style. Default `classic` |
| `--lang <code>` | Spoken language such as `en`, `es`, `de`. Default auto-detect |
| `--res <shortSide>` | `720`, `1080`, `1440` or `2160`. Above 720 needs Pro |
| `--no-cache` | Transcribe again, ignoring the cached transcript |

If the result has a `notice`, the export used the free plan. The user already chose that in Setup, so mention it only if they seem surprised by the watermark.

## restyle

The same command with a different `--preset` and a different `-o`, so the first render is kept:

```bash
npx autosubtitles talk.mp4 --preset karaoke -o talk.karaoke.mp4 --json
```

The transcript is cached on the user's machine, so only the render runs. `transcriptCached: true` in the result confirms it.

## styles

```bash
npx autosubtitles presets --json
```

Returns `[{ "id": "...", "name": "..." }]`. Match a style the user names to an `id`. If you have to choose, use `classic` for talking-head or business video and `beast` for short-form social video, and say which you picked. To let the user see them, use `live` or `review`, or point them to https://autosubtitles.com/agent.
