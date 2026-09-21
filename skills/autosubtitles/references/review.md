# review

One window, one result. Use it when the user should choose by looking and you cannot hold a background loop (otherwise prefer the `live` command).

```bash
npx autosubtitles review <video> --json
```

A small window opens on the user's screen: their video playing with the captions on it, and every style in a column beside it. **Check captions first** swaps the styles for the captions as editable lines with timings. They click **Render video** or **Cancel**; the window closes itself and the command prints one JSON object.

Tell the user the window has opened, then wait for the command. It blocks until they act.

| Flag | Meaning |
|---|---|
| `--preset <id>` | Open with a style already applied |
| `--captions` | Open straight at the captions step, for "let me check the wording" |
| `--idle <minutes>` | Close if nobody touches the window. Default 10 |
| `-o`, `--lang`, `--res` | As for `caption` |

`action` in the result:

- `render`: `outputs.mp4` is the file, `preset` is the style they chose, `edited` says whether they changed any captions. Report all three.
- `cancel`: they cancelled or closed the window. Nothing was rendered. Ask what they would like instead.
- `timeout`: nobody touched the window. Nothing was rendered. Ask whether to try again; do not reopen it unasked.
