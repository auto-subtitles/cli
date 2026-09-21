import { chromium } from 'playwright-core';
import { mkdir, mkdtemp, rename, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { CliError } from './render.js';

/**
 * Open the site's /review page in a bare Chrome app window (no tabs, no
 * address bar) and hand back the page plus the helpers every review flow needs.
 */
export async function openReviewWindow({ baseUrl, browser, output }) {
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
                ignoreHTTPSErrors: !baseUrl.startsWith('https://autosubtitles.com'),
                // Playwright launches Chrome with --no-sandbox and --enable-automation by default. In a
                // window the user looks at, each puts a warning bar across the top, and running
                // without the sandbox is a worse security posture than their normal Chrome.
                chromiumSandbox: true,
                ignoreDefaultArgs: ['--enable-automation'],
                args: [`--app=${baseUrl}/review`, '--window-size=1280,860'],
            });
            break;
        } catch {
            // Try the next browser.
        }
    }
    if (!context) {
        await rm(profileDir, { recursive: true, force: true }).catch(() => {});
        throw new CliError('No usable browser found. Install Google Chrome or Microsoft Edge and try again.', 3, 'no_browser');
    }

    const close = async () => {
        // Can hang forever if the browser has already died; callers must not depend on it returning.
        await Promise.race([context.close().catch(() => {}), new Promise((r) => setTimeout(r, 5_000))]);
        await rm(profileDir, { recursive: true, force: true }).catch(() => {});
    };

    try {
        const page = context.pages()[0] ?? (await context.waitForEvent('page'));
        await page.waitForFunction(() => !!window.autosubtitlesReview, null, { timeout: 30_000 }).catch(() => {
            throw new CliError(`${baseUrl}/review did not load. Check your connection and try again.`, 1, 'page_unavailable');
        });

        // The export arrives as a download. Save to a .part file first, then rename, so an
        // interrupted save never replaces or truncates a video that is already there.
        const save = { path: null, failed: false, pending: [] };
        page.on('download', (download) => {
            save.pending.push(
                (async () => {
                    await mkdir(path.dirname(output), { recursive: true });
                    const partial = `${output}.part`;
                    await download.saveAs(partial);
                    await rename(partial, output);
                    save.path = path.resolve(output);
                })().catch((error) => {
                    save.failed = true;
                    if (process.env.AUTOSUBTITLES_DEBUG) console.error('save failed:', error?.message ?? error);
                }),
            );
        });

        /** Wait for the rendered video to be on disk; returns its path or throws. */
        const waitForSave = async () => {
            const deadline = Date.now() + 60_000;
            while (save.pending.length < 1 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100));
            await Promise.all(save.pending);
            if (save.failed || !save.path) {
                throw new CliError('The video rendered, but the window was closed before it finished saving. Run the command again and leave the window to close by itself.', 6, 'save_interrupted');
            }
            return save.path;
        };

        /** Resolves when the user closes the window themselves. */
        const closedByUser = new Promise((resolve) => {
            page.on('close', () => resolve({ ok: true, action: 'cancel' }));
            context.on('close', () => resolve({ ok: true, action: 'cancel' }));
        });

        /** Resolves after `idleMinutes` with no pointer or key activity in the window. */
        const idle = (idleMinutes) => {
            let timer;
            const promise = new Promise((resolve) => {
                timer = setInterval(async () => {
                    const last = await page.evaluate(() => window.autosubtitlesLastActivity ?? Date.now()).catch(() => Date.now());
                    if (Date.now() - last > idleMinutes * 60_000) resolve({ ok: true, action: 'timeout' });
                }, 5_000);
            });
            return { promise, stop: () => clearInterval(timer) };
        };

        return { page, close, waitForSave, closedByUser, idle };
    } catch (error) {
        await close();
        throw error;
    }
}
