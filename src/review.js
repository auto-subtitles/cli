import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { CliError, DEFAULT_BASE_URL, EXIT_CODES, transcriptCachePath } from './render.js';
import { openReviewWindow } from './window.js';

/**
 * One-shot review: open the window, wait for the user to click Render or
 * Cancel, save the video and return one result. For a session the agent can
 * answer requests in, see session.js.
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

    const started = Date.now();
    const win = await openReviewWindow({ baseUrl, browser, output });
    try {
        const { page } = win;
        await page.locator('#video-input').setInputFiles(input);
        onProgress('Review window open. Waiting for you to click Render or Cancel…');

        // Test hook: click Render as soon as it appears, so the save path can be checked unattended.
        if (process.env.AUTOSUBTITLES_REVIEW_AUTORENDER) {
            page.getByRole('button', { name: 'Render video' })
                .click({ timeout: 10 * 60_000 })
                .catch(() => {});
        }

        const idle = win.idle(idleMinutes);
        const result = await Promise.race([
            page.evaluate((request) => window.autosubtitlesReview.review(request), { preset, language, maxShortSide: resolution, licenseKey, transcription, step }),
            win.closedByUser,
            idle.promise,
        ]).finally(idle.stop);

        if (!result.ok) throw new CliError(result.error.message, EXIT_CODES[result.error.code] ?? 1, result.error.code);
        if (result.action !== 'render') return { ok: true, action: result.action };

        const mp4 = await win.waitForSave();
        if (cache && !transcription) {
            await mkdir(path.dirname(cachePath), { recursive: true })
                .then(() => writeFile(cachePath, JSON.stringify(result.transcription)))
                .catch(() => {});
        }
        return {
            ok: true,
            action: 'render',
            outputs: { mp4 },
            preset: result.preset,
            captionCount: result.captionCount,
            edited: result.edited ?? false,
            durationSeconds: result.durationSeconds,
            watermark: result.watermark,
            seconds: Number(((Date.now() - started) / 1000).toFixed(1)),
        };
    } finally {
        await win.close();
    }
}
