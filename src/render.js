import { chromium } from 'playwright-core';
import { mkdir, open, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

export const DEFAULT_BASE_URL = 'https://autosubtitles.com';
// Must match API_VERSION on the site's /render page.
const SUPPORTED_API_VERSION = 1;

export class CliError extends Error {
    constructor(message, exitCode = 1, code = 'error') {
        super(message);
        this.exitCode = exitCode;
        this.code = code;
    }
}

// Page error code → process exit code.
export const EXIT_CODES = {
    unknown_preset: 2,
    no_file: 2,
    duration_limit: 4,
    not_allowed: 4,
    license_required: 4,
    rate_limited: 4,
    transcription_failed: 5,
    render_failed: 6,
    cancelled: 130,
};

/** Per-user cache folder, so transcripts never land beside the user's video. */
function cacheDir() {
    if (process.env.AUTOSUBTITLES_CACHE_DIR) return process.env.AUTOSUBTITLES_CACHE_DIR;
    if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Caches', 'autosubtitles');
    if (process.platform === 'win32') return path.join(process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local'), 'autosubtitles', 'Cache');
    return path.join(process.env.XDG_CACHE_HOME ?? path.join(os.homedir(), '.cache'), 'autosubtitles');
}

/**
 * Cache key from the file's size and its first megabyte, not its path, so a
 * renamed or moved video still hits the cache and a different video never does.
 */
export async function transcriptCachePath(input) {
    const { size } = await stat(input);
    const handle = await open(input, 'r');
    try {
        const head = Buffer.alloc(Math.min(size, 1024 * 1024));
        await handle.read(head, 0, head.length, 0);
        const key = createHash('sha256').update(String(size)).update(head).digest('hex').slice(0, 32);
        return path.join(cacheDir(), `${key}.json`);
    } finally {
        await handle.close();
    }
}

const LAUNCH_ARGS = ['--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows'];

/**
 * Installed Chrome first: it has hardware H.264 and the proprietary codecs.
 * A Playwright Chromium, if one happens to be installed, is the last resort.
 */
async function launchBrowser({ browser, headed }) {
    const channels = browser ? [browser] : ['chrome', 'msedge', 'chromium'];
    for (const channel of channels) {
        try {
            return await chromium.launch({
                channel: channel === 'chromium' ? undefined : channel,
                headless: !headed,
                args: LAUNCH_ARGS,
            });
        } catch {
            // Try the next one.
        }
    }
    throw new CliError(
        'No usable browser found. Install Google Chrome (https://www.google.com/chrome/) or Microsoft Edge and try again.',
        3,
        'no_browser',
    );
}

async function openRenderPage(browserInstance, baseUrl) {
    const context = await browserInstance.newContext({
        acceptDownloads: true,
        // Local development sites (e.g. https://autosubtitles.test) use self-signed certificates.
        ignoreHTTPSErrors: baseUrl !== DEFAULT_BASE_URL,
    });
    const page = await context.newPage();
    await page.goto(`${baseUrl}/render`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!window.autosubtitles, null, { timeout: 30_000 }).catch(() => {
        throw new CliError(`${baseUrl}/render did not load. Check your connection and try again.`, 1, 'page_unavailable');
    });
    const apiVersion = await page.evaluate(() => window.autosubtitles.apiVersion);
    if (apiVersion !== SUPPORTED_API_VERSION) {
        throw new CliError('This version of autosubtitles is out of date. Run: npm install -g autosubtitles@latest', 1, 'outdated_cli');
    }
    return page;
}

/**
 * Whether exports will use the free or the licensed tier. Reports the tier
 * only: never the key, the account email or anything else about the license.
 */
export async function getPlan({ baseUrl = DEFAULT_BASE_URL, licenseKey } = {}) {
    const free = (reason) => ({ plan: 'free', reason, watermark: true, maxShortSide: 720, maxMinutes: 10, subtitleFiles: false });
    if (!licenseKey) return free('no_key');
    try {
        const response = await fetch(`${baseUrl}/api/license/validate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({ key: licenseKey }),
        });
        const data = await response.json();
        if (data.valid === true) return { plan: 'pro', watermark: false, maxShortSide: 2160, maxMinutes: null, subtitleFiles: true };
        return free(data.reason ?? 'invalid_key');
    } catch {
        return free('could_not_check');
    }
}

export async function listPresets({ baseUrl = DEFAULT_BASE_URL, browser, headed } = {}) {
    const browserInstance = await launchBrowser({ browser, headed });
    try {
        const page = await openRenderPage(browserInstance, baseUrl);
        return await page.evaluate(() => window.autosubtitles.presets);
    } finally {
        await browserInstance.close();
    }
}

/**
 * Caption `input` and write the results next to `output`.
 * Returns the JSON-serialisable result the CLI prints with --json.
 */
export async function captionVideo({
    input,
    output,
    preset,
    language,
    resolution,
    formats = [],
    captionsOnly = false,
    licenseKey,
    cache = true,
    baseUrl = DEFAULT_BASE_URL,
    browser,
    headed = false,
    onProgress = () => {},
    signal,
}) {
    if (!existsSync(input)) throw new CliError(`File not found: ${input}`, 2, 'file_not_found');

    const outputBase = output.replace(/\.mp4$/i, '');
    const outputs = [...(captionsOnly ? [] : ['mp4']), ...formats];
    if (outputs.length === 0) throw new CliError('Nothing to do: --captions-only needs --srt, --vtt or --words.', 2, 'usage');
    const targets = { mp4: `${outputBase}.mp4`, srt: `${outputBase}.srt`, vtt: `${outputBase}.vtt`, json: `${outputBase}.words.json` };

    // The transcript is cached so re-renders in another style don't transcribe twice.
    const cachePath = await transcriptCachePath(input);
    let transcription;
    if (cache && existsSync(cachePath)) {
        transcription = JSON.parse(await readFile(cachePath, 'utf8'));
    }

    const browserInstance = await launchBrowser({ browser, headed });
    const started = Date.now();
    try {
        const page = await openRenderPage(browserInstance, baseUrl);

        const saved = {};
        const pending = [];
        page.on('download', (download) => {
            pending.push(
                (async () => {
                    const name = download.suggestedFilename();
                    const kind = name.endsWith('.mp4') ? 'mp4' : name.split('.').pop();
                    const tmp = await download.path();
                    await mkdir(path.dirname(targets[kind]), { recursive: true });
                    await rename(tmp, targets[kind]).catch(() => download.saveAs(targets[kind]));
                    saved[kind] = path.resolve(targets[kind]);
                })(),
            );
        });

        await page.exposeFunction('__autosubtitlesProgress', (stage, pct) => onProgress(stage, pct));
        await page.evaluate(() => {
            window.autosubtitles.onProgress = window.__autosubtitlesProgress;
        });
        signal?.addEventListener('abort', () => page.evaluate(() => window.autosubtitles.cancel()).catch(() => {}));

        await page.locator('#video-input').setInputFiles(input);
        const result = await page.evaluate((request) => window.autosubtitles.render(request), {
            preset,
            language,
            maxShortSide: resolution,
            outputs,
            licenseKey,
            transcription,
        });

        if (!result.ok) {
            throw new CliError(result.error.message, EXIT_CODES[result.error.code] ?? 1, result.error.code);
        }

        // Downloads are dispatched just before render() resolves; wait for every expected file.
        // Wait for what the page actually wrote: on the free plan it skips subtitle files.
        const expected = result.files?.length ?? outputs.length;
        const deadline = Date.now() + 60_000;
        while (pending.length < expected && Date.now() < deadline) {
            await new Promise((r) => setTimeout(r, 100));
        }
        await Promise.all(pending);

        if (cache && !transcription) {
            // Best effort: a read-only home directory must not fail a finished render.
            await mkdir(path.dirname(cachePath), { recursive: true })
                .then(() => writeFile(cachePath, JSON.stringify(result.transcription)))
                .catch(() => {});
        }

        return {
            ok: true,
            outputs: saved,
            durationSeconds: result.durationSeconds,
            captionCount: result.captionCount,
            seconds: Number(((Date.now() - started) / 1000).toFixed(1)),
            preset: result.preset,
            watermark: result.watermark,
            maxShortSide: result.maxShortSide,
            transcriptCached: Boolean(transcription),
            skipped: result.skipped ?? [],
            ...(result.watermark
                ? {
                      notice:
                          (result.skipped?.length ? 'Subtitle files need Pro, so they were not written. ' : '') +
                          'Free plan: watermarked, up to 720p. AutoSubtitles Pro removes the watermark, exports up to 4K and adds SRT and VTT files: https://autosubtitles.com',
                  }
                : {}),
        };
    } finally {
        await browserInstance.close();
    }
}
