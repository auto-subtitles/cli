import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, openSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cacheDir, CliError, DEFAULT_BASE_URL, transcriptCachePath } from './render.js';
import { openReviewWindow } from './window.js';

/**
 * A live review session. Unlike the one-shot `review`, the window stays open
 * while the agent does other things: the user can type a request in it
 * ("make the captions yellow"), the agent picks that up with `poll`, applies
 * changes with `reply`, the user watches the video update, and clicks Render.
 *
 *   review --live   start: spawns a detached helper that owns the window
 *   poll            wait for the next event: steer | render | cancel | timeout
 *   reply           apply changes in the window and answer the user
 *   close           end the session
 *
 * The helper serves a tiny token-protected HTTP API on 127.0.0.1. One session
 * at a time, described by session.json in the cache folder.
 */

const sessionFile = () => path.join(cacheDir(), 'session.json');
const logFile = () => path.join(cacheDir(), 'session.log');
const FINAL = new Set(['render', 'cancel', 'timeout', 'error']);

async function readSession() {
    try {
        return JSON.parse(await readFile(sessionFile(), 'utf8'));
    } catch {
        return null;
    }
}

const alive = (pid) => {
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
};

async function call(session, method, route, body, timeoutMs = 30_000) {
    const response = await fetch(`http://127.0.0.1:${session.port}${route}`, {
        method,
        headers: { 'Content-Type': 'application/json', 'X-Session-Token': session.token },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
    });
    return response.json();
}

/* ---------- Commands the agent runs ---------- */

export async function startSession(options) {
    if (!existsSync(options.input)) throw new CliError(`File not found: ${options.input}`, 2, 'file_not_found');
    const existing = await readSession();
    if (existing?.pid && alive(existing.pid) && !existing.final) {
        throw new CliError(`A review session is already open for ${existing.input}. Use \`autosubtitles poll\`, or \`autosubtitles close\` to end it.`, 2, 'session_active');
    }
    await mkdir(cacheDir(), { recursive: true });
    await rm(sessionFile(), { force: true });

    const log = openSync(logFile(), 'w');
    const bin = fileURLToPath(new URL('../bin/autosubtitles.js', import.meta.url));
    const child = spawn(process.execPath, [bin, '__session', JSON.stringify(options)], { detached: true, stdio: ['ignore', log, log], env: process.env });
    child.unref();

    // The helper writes session.json once the window is open and the server is listening.
    const deadline = Date.now() + 45_000;
    while (Date.now() < deadline) {
        const session = await readSession();
        if (session?.error) {
            await rm(sessionFile(), { force: true });
            throw new CliError(session.error.message, session.error.exitCode ?? 1, session.error.code ?? 'error');
        }
        if (session?.port) return { ok: true, action: 'started', input: session.input, next: 'Run `autosubtitles poll --json` to wait for what the user does.' };
        await new Promise((r) => setTimeout(r, 200));
    }
    throw new CliError('The review window did not open in time.', 1, 'session_start_timeout');
}

export async function pollSession({ timeoutSeconds = 600 } = {}) {
    const session = await readSession();
    if (!session) throw new CliError('No review session is open. Start one with `autosubtitles review <video> --live`.', 2, 'no_session');

    if (session.port && alive(session.pid)) {
        try {
            const event = await call(session, 'GET', `/poll?timeout=${timeoutSeconds}`, undefined, (timeoutSeconds + 15) * 1000);
            if (FINAL.has(event.type)) await rm(sessionFile(), { force: true });
            return event;
        } catch {
            // The helper went away mid-request: fall through to whatever it left behind.
        }
    }
    const after = await readSession();
    await rm(sessionFile(), { force: true });
    if (after?.final) return after.final;
    return { type: 'cancel', reason: 'The review window is no longer open.' };
}

export async function replyToSession(changes) {
    const session = await readSession();
    if (!session?.port || !alive(session.pid)) throw new CliError('No review session is open.', 2, 'no_session');
    return call(session, 'POST', '/reply', changes);
}

export async function closeSession() {
    const session = await readSession();
    if (session?.port && alive(session.pid)) await call(session, 'POST', '/close', {}).catch(() => {});
    await rm(sessionFile(), { force: true });
    return { ok: true, action: 'closed' };
}

/* ---------- The detached helper ---------- */

export async function runSessionHelper(options) {
    const { input, output, preset, language, resolution, licenseKey, step, idleMinutes = 10, cache = true, baseUrl = DEFAULT_BASE_URL, browser } = options;
    const token = randomBytes(24).toString('hex');
    const queue = [];
    let waiter = null;
    let final = null;
    let listening = false;
    let win;
    // Resolved by POST /close so the agent can end a session the user has not finished.
    let requestClose;
    let closedByAgent = false;
    const closeRequested = new Promise((resolve) => (requestClose = resolve));

    const emit = (event) => {
        if (FINAL.has(event.type)) final = event;
        if (waiter) {
            const resolve = waiter;
            waiter = null;
            resolve(event);
        } else queue.push(event);
    };

    const fail = async (error) => {
        const detail = { message: error?.message ?? String(error), code: error?.code ?? 'error', exitCode: error?.exitCode ?? 1 };
        await writeFile(sessionFile(), JSON.stringify({ pid: process.pid, input, error: detail })).catch(() => {});
        await Promise.race([win?.close(), new Promise((r) => setTimeout(r, 5_000))]);
        process.exit(1);
    };

    try {
        const cachePath = await transcriptCachePath(input);
        let transcription;
        if (cache && existsSync(cachePath)) transcription = JSON.parse(await readFile(cachePath, 'utf8'));

        win = await openReviewWindow({ baseUrl, browser, output });
        const { page } = win;
        await page.locator('#video-input').setInputFiles(input);

        const server = http.createServer(async (req, res) => {
            const send = (status, body) => {
                res.writeHead(status, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(body));
            };
            if (req.headers['x-session-token'] !== token) return send(403, { ok: false, error: 'forbidden' });
            const url = new URL(req.url, 'http://127.0.0.1');

            if (req.method === 'GET' && url.pathname === '/poll') {
                if (queue.length) return send(200, queue.shift());
                const seconds = Math.min(Number(url.searchParams.get('timeout')) || 600, 3600);
                const timer = setTimeout(() => {
                    waiter = null;
                    send(200, { type: 'waiting' });
                }, seconds * 1000);
                waiter = (event) => {
                    clearTimeout(timer);
                    send(200, event);
                };
                return;
            }

            let body = '';
            for await (const chunk of req) body += chunk;
            const data = body ? JSON.parse(body) : {};

            if (req.method === 'POST' && url.pathname === '/reply') {
                const result = await page.evaluate((changes) => window.autosubtitlesReview.apply(changes), data).catch((e) => ({ ok: false, error: e.message }));
                // Test hook, second half: once the agent has answered, click Render.
                if (process.env.AUTOSUBTITLES_TEST_STEER && result.ok) page.getByRole('button', { name: 'Render video' }).click().catch(() => {});
                return send(200, result);
            }
            if (req.method === 'POST' && url.pathname === '/close') {
                send(200, { ok: true });
                closedByAgent = true;
                requestClose({ ok: true, action: 'cancel' });
                return;
            }
            send(404, { ok: false, error: 'not_found' });
        });
        await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
        await writeFile(sessionFile(), JSON.stringify({ pid: process.pid, port: server.address().port, token, input, startedAt: new Date().toISOString() }), { mode: 0o600 });
        listening = true;

        // Test hook, first half: type a request into the window as a user would, so the
        // whole poll/reply loop can be checked with nobody at the keyboard.
        if (process.env.AUTOSUBTITLES_TEST_STEER) {
            (async () => {
                const box = page.getByLabel('Ask your agent for a change');
                await box.waitFor({ timeout: 10 * 60_000 });
                await box.fill(process.env.AUTOSUBTITLES_TEST_STEER);
                await page.getByRole('button', { name: 'Send' }).click();
            })().catch(() => {});
        }

        // Requests the user types in the window, one at a time, until the session ends.
        (async () => {
            while (!final) {
                const event = await page.evaluate(() => window.autosubtitlesReview.nextEvent()).catch(() => null);
                if (!event) return;
                emit(event);
            }
        })();

        const idle = win.idle(idleMinutes);
        const started = Date.now();
        const result = await Promise.race([
            page.evaluate((request) => window.autosubtitlesReview.review(request), { preset, language, maxShortSide: resolution, licenseKey, transcription, step, live: true }),
            win.closedByUser,
            idle.promise,
            closeRequested,
        ]).finally(idle.stop);

        if (!result.ok) {
            emit({ type: 'error', error: result.error });
        } else if (result.action !== 'render') {
            emit({ type: result.action });
        } else {
            const mp4 = await win.waitForSave();
            if (cache && !transcription) {
                await mkdir(path.dirname(cachePath), { recursive: true })
                    .then(() => writeFile(cachePath, JSON.stringify(result.transcription)))
                    .catch(() => {});
            }
            emit({
                type: 'render',
                outputs: { mp4 },
                preset: result.preset,
                captionCount: result.captionCount,
                edited: result.edited ?? false,
                durationSeconds: result.durationSeconds,
                watermark: result.watermark,
                seconds: Number(((Date.now() - started) / 1000).toFixed(1)),
            });
        }
    } catch (error) {
        // Before the server is up nobody can poll, so report through session.json instead.
        if (!listening) return fail(error);
        if (!final) emit({ type: 'error', error: { code: error?.code ?? 'error', message: error?.message ?? String(error) } });
    }

    // The window is finished. Shutting the browser down can hang for good when the window
    // has already gone, so it gets five seconds and the process always exits on its own.
    setTimeout(() => process.exit(0), 130_000).unref();
    await Promise.race([win?.close(), new Promise((r) => setTimeout(r, 5_000))]);
    // The agent asked for this, so there is no result for anyone to collect.
    if (closedByAgent) process.exit(0);

    // Otherwise keep the result reachable for a poll that arrives late.
    // Only if nobody has collected it yet: a delivered result must not come back on the next poll.
    if (queue.includes(final)) {
        const session = (await readSession()) ?? {};
        await writeFile(sessionFile(), JSON.stringify({ ...session, final })).catch(() => {});
    }
    const deadline = Date.now() + 120_000;
    while (queue.includes(final) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 250));
    process.exit(0);
}
