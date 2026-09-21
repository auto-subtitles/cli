import { chromium } from 'playwright-core';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { CliError, DEFAULT_BASE_URL, EXIT_CODES, transcriptCachePath } from './render.js';

/**
 * Open the review window: the video with its captions, the captions as
 * editable lines, a strip of styles, and Render / Cancel. Resolves when the
 * user clicks one, so an agent can pause on it and then carry on. An agent must
 * never hang on an unattended machine, so an idle window closes itself.
 */
export async function reviewVideo({
    input,
    output,
    preset,
    language,
    resolution,
    licenseKey,
    step,
    idleMinutes = 10,
    cache = true,
    baseUrl = DEFAULT_BASE_URL,
    browser,
    onProgress = () => {},
}) {
    if (!existsSync(input)) throw new CliError(`File not found: ${input}`, 2, 'file_not_found');

    const cachePath = await transcriptCachePath(input);
    let transcription;
    if (cache && existsSync(cachePath)) transcription = JSON.parse(await readFile(cachePath, 'utf8'));

    // A fresh profile every run. Reusing one made Chrome close the app window the
    // moment the export download started, which killed the save (seen on Chrome 153).
    const profileDir = await mkdtemp(path.join(os.tmpdir(), 'autosubtitles-review-'));

    let context;
    for (const channel of browser ? [browser] : ['chrome', 'msedge']) {
        try {
            context = await chromium.launchPersistentContext(profileDir, {
                channel,
                headless: false,
                viewport: null,
                acceptDownloads: true,
                ignoreHTTPSErrors: baseUrl !== DEFAULT_BASE_URL,
                // --app gives a bare window: no tabs, no address bar.
                args: [`--app=${baseUrl}/review`, '--window-size=1280,860'],
            });
            break;
        } catch {
            // Try the next browser.
        }
    }
    if (!context) throw new CliError('No usable browser found. Install Google Chrome or Microsoft Edge and try again.', 3, 'no_browser');

    const started = Date.now();
    try {
        const page = context.pages()[0] ?? (await context.waitForEvent('page'));
        await page.waitForFunction(() => !!window.autosubtitlesReview, null, { timeout: 30_000 }).catch(() => {
            throw new CliError(`${baseUrl}/review did not load. Check your connection and try again.`, 1, 'page_unavailable');
        });

        let savedTo = null;
        let saveFailed = false;
        const pending = [];
        page.on('download', (download) => {
            pending.push(
                (async () => {
                    await mkdir(path.dirname(output), { recursive: true });
                    // Save to a temporary name first, so an interrupted save never
                    // replaces or truncates a video that is already there.
                    const partial = `${output}.part`;
                    await download.saveAs(partial);
                    await rename(partial, output);
                    savedTo = path.resolve(output);
                })().catch((error) => {
                    saveFailed = true;
                    if (process.env.AUTOSUBTITLES_DEBUG) console.error('save failed:', error?.message ?? error);
                }),
            );
        });

        // If the user closes the window instead of clicking a button, treat it as Cancel.
        const closed = new Promise((resolve) => {
            page.on('close', () => resolve({ ok: true, action: 'cancel' }));
            context.on('close', () => resolve({ ok: true, action: 'cancel' }));
        });

        await page.locator('#video-input').setInputFiles(input);
        onProgress('Review window open. Waiting for you to click Render or Cancel…');
        // Test hook: click Render as soon as it appears, so the save path can be checked unattended.
        if (process.env.AUTOSUBTITLES_REVIEW_AUTORENDER) {
            page.getByRole('button', { name: 'Render video' })
                .click({ timeout: 10 * 60_000 })
                .catch(() => {});
        }
        // Idle means no pointer or key activity in the window, so someone slowly
        // fixing captions is never cut off, but an empty room is.
        let idleTimer;
        const idle = new Promise((resolve) => {
            idleTimer = setInterval(async () => {
                const last = await page.evaluate(() => window.autosubtitlesLastActivity ?? Date.now()).catch(() => Date.now());
                if (Date.now() - last > idleMinutes * 60_000) resolve({ ok: true, action: 'timeout' });
            }, 5_000);
        });

        const result = await Promise.race([
            page.evaluate((request) => window.autosubtitlesReview.review(request), { preset, language, maxShortSide: resolution, licenseKey, transcription, step }),
            closed,
            idle,
        ]).finally(() => clearInterval(idleTimer));

        if (!result.ok) throw new CliError(result.error.message, EXIT_CODES[result.error.code] ?? 1, result.error.code);
        if (result.action === 'cancel' || result.action === 'timeout') return { ok: true, action: result.action };

        const deadline = Date.now() + 60_000;
        while (pending.length < 1 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100));
        await Promise.all(pending);
        if (saveFailed || !savedTo) {
            throw new CliError('The video rendered, but the window was closed before it finished saving. Run the command again and leave the window to close by itself.', 6, 'save_interrupted');
        }

        if (cache && !transcription) {
            await mkdir(path.dirname(cachePath), { recursive: true })
                .then(() => writeFile(cachePath, JSON.stringify(result.transcription)))
                .catch(() => {});
        }

        return {
            ok: true,
            action: 'render',
            outputs: { mp4: savedTo },
            preset: result.preset,
            captionCount: result.captionCount,
            edited: result.edited ?? false,
            durationSeconds: result.durationSeconds,
            watermark: result.watermark,
            seconds: Number(((Date.now() - started) / 1000).toFixed(1)),
        };
    } finally {
        await context.close().catch(() => {});
        await rm(profileDir, { recursive: true, force: true }).catch(() => {});
    }
}
