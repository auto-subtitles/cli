# subtitles (Pro)

SRT, VTT and word-timing files are a Pro feature, as they are in the AutoSubtitles web editor. Run `plan` first (Setup). On the free plan, do not run these: tell the user subtitle files need Pro, and that the captioned video itself is free.

With the video:

```bash
npx autosubtitles <video> --preset <style> --srt --vtt --json
```

Files only, no render:

```bash
npx autosubtitles <video> --captions-only --srt --vtt --json
```

`--words` also writes word-level timings as JSON. Paths come back in `outputs`. If the plan turns out to be free, files asked for alongside a video are listed in `skipped` and the video still renders; a files-only request exits 4.
