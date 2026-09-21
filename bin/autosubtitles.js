#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { reviewVideo } from '../src/review.js';
import { captionVideo, CliError, DEFAULT_BASE_URL, getPlan, listPresets } from '../src/render.js';

const HELP = `autosubtitles — add styled, burned-in captions to a video. Renders locally in your own Chrome.

Usage
  autosubtitles <video> [options]     caption a video
  autosubtitles review <video>        pick a style (and check captions) in a small window, then render
  autosubtitles presets [--json]      list caption styles
  autosubtitles plan [--json]         show whether you are on Free or Pro

Options
  -o, --output <path>     output MP4 (default: <name>.captioned.mp4)
  -p, --preset <name>     caption style (default: classic). See: autosubtitles presets
      --lang <code>       spoken language, e.g. en, es, de (default: auto-detect)
      --res <shortSide>   720, 1080, 1440 or 2160 (above 720 needs Pro)
      --srt --vtt --words also write subtitle files beside the output (Pro)
      --captions-only     write subtitle files only, skip the video (Pro)
      --captions          review: open at the captions step
      --idle <minutes>    review: close the window if nobody touches it (default 10)
      --no-cache          transcribe again even if a cached transcript exists
      --json              print one JSON result on stdout
      --headed            show the browser window
      --browser <name>    chrome, msedge or chromium
  -h, --help
  -v, --version

Free and Pro
  Free: captioned video, watermarked, up to 720p, videos up to 10 minutes.
  Pro:  no watermark, up to 4K, no length limit, SRT and VTT files.
  Set AUTOSUBTITLES_LICENSE_KEY to your AutoSubtitles Pro license key.
  https://autosubtitles.com
`;

const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
        output: { type: 'string', short: 'o' },
        preset: { type: 'string', short: 'p' },
        lang: { type: 'string' },
        res: { type: 'string' },
        srt: { type: 'boolean' },
        vtt: { type: 'boolean' },
        words: { type: 'boolean' },
        'captions-only': { type: 'boolean' },
        captions: { type: 'boolean' },
        idle: { type: 'string' },
        'no-cache': { type: 'boolean' },
        json: { type: 'boolean' },
        headed: { type: 'boolean' },
        browser: { type: 'string' },
        help: { type: 'boolean', short: 'h' },
        version: { type: 'boolean', short: 'v' },
    },
});

// AUTOSUBTITLES_URL points the CLI at a development copy of the site.
const baseUrl = (process.env.AUTOSUBTITLES_URL ?? DEFAULT_BASE_URL).replace(/\/$/, '');
const common = { baseUrl, browser: values.browser, headed: values.headed };

function fail(error) {
    const exitCode = error instanceof CliError ? error.exitCode : 1;
    const code = error instanceof CliError ? error.code : 'error';
    if (values.json) console.log(JSON.stringify({ ok: false, error: { code, message: error.message } }));
    else console.error(`autosubtitles: ${error.message}`);
    process.exit(exitCode);
}

async function main() {
    if (values.version) {
        const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
        console.log(pkg.version);
        return;
    }
    if (values.help || positionals.length === 0) {
        console.log(HELP);
        return;
    }

    if (positionals[0] === 'presets') {
        const presets = await listPresets(common);
        if (values.json) console.log(JSON.stringify(presets));
        else for (const p of presets) console.log(`${p.id.padEnd(14)} ${p.name}`);
        return;
    }

    if (positionals[0] === 'plan') {
        const plan = await getPlan({ baseUrl, licenseKey: process.env.AUTOSUBTITLES_LICENSE_KEY });
        if (values.json) console.log(JSON.stringify(plan));
        else if (plan.plan === 'pro') console.log('Pro: no watermark, up to 4K, no length limit, SRT and VTT files.');
        else console.log(`Free (${plan.reason.replace(/_/g, ' ')}): captioned video, watermarked, up to 720p, videos up to 10 minutes. No subtitle files.`);
        return;
    }

    if (positionals[0] === 'review') {
        if (!positionals[1]) throw new CliError('Usage: autosubtitles review <video> [--preset <name>]', 2, 'usage');
        const video = path.resolve(positionals[1]);
        const p = path.parse(video);
        const result = await reviewVideo({
            input: video,
            output: path.resolve(values.output ?? path.join(p.dir, `${p.name}.captioned.mp4`)),
            preset: values.preset,
            language: values.lang,
            resolution: values.res ? Number(values.res) : undefined,
            step: values.captions ? 'captions' : 'style',
            idleMinutes: values.idle ? Number(values.idle) : undefined,
            cache: !values['no-cache'],
            licenseKey: process.env.AUTOSUBTITLES_LICENSE_KEY,
            baseUrl,
            browser: values.browser,
            onProgress: (line) => console.error(line),
        });
        if (values.json) console.log(JSON.stringify(result));
        else if (result.action === 'cancel') console.log('Cancelled. Nothing was rendered.');
        else if (result.action === 'timeout') console.log('Nobody used the review window, so it was closed. Nothing was rendered.');
        else console.log(result.outputs.mp4);
        return;
    }

    const input = path.resolve(positionals[0]);
    const parsed = path.parse(input);
    const output = path.resolve(values.output ?? path.join(parsed.dir, `${parsed.name}.captioned.mp4`));
    const resolution = values.res ? Number(values.res) : undefined;
    if (values.res && !Number.isFinite(resolution)) throw new CliError('--res must be a number, e.g. 1080.', 2, 'usage');

    const controller = new AbortController();
    process.once('SIGINT', () => controller.abort());

    let lastLine = '';
    const result = await captionVideo({
        ...common,
        input,
        output,
        preset: values.preset,
        language: values.lang,
        resolution,
        formats: [values.srt && 'srt', values.vtt && 'vtt', values.words && 'json'].filter(Boolean),
        captionsOnly: values['captions-only'],
        cache: !values['no-cache'],
        licenseKey: process.env.AUTOSUBTITLES_LICENSE_KEY,
        signal: controller.signal,
        onProgress: (stage, pct) => {
            const line = `${stage} ${Math.round(pct)}%`;
            if (line === lastLine) return;
            lastLine = line;
            // Progress goes to stderr so stdout stays parseable with --json.
            if (process.stderr.isTTY) process.stderr.write(`\r\x1b[K${line}`);
        },
    });
    if (process.stderr.isTTY) process.stderr.write('\r\x1b[K');

    if (values.json) {
        console.log(JSON.stringify(result));
    } else {
        for (const file of Object.values(result.outputs)) console.log(file);
        if (result.notice) console.error(result.notice);
    }
}

main().catch(fail);
