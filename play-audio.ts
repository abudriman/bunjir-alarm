import { $ } from "bun";
import * as path from "path";
import * as fs from "fs/promises"; // Needed for fs.readdir, fs.unlink
import * as mm from 'music-metadata';

// Explicit paths from your setup
const SCRIPT_PATH = "E:\\Arif\\projects\\node\\bunjir-alarm\\play_audio.ps1";

/**
 * Gets the duration of an audio file in milliseconds.
 * @param filePath Absolute path to the audio file.
 * @returns Duration in milliseconds.
 */
export async function getAudioDurationMs(filePath: string): Promise<number> {
    try {
        const metadata = await mm.parseFile(filePath);
        if (metadata.format.duration) {
            // Convert seconds to milliseconds and add a small buffer (e.g., 500ms)
            return (metadata.format.duration * 1000) + 500;
        }
        throw new Error("Could not determine audio duration from metadata.");
    } catch (error) {
        console.error("Error reading audio metadata:", error);
        // Fallback duration if metadata reading fails (e.g., 30 seconds)
        return 30000;
    }
}

/**
 * Executes the PowerShell script with -NoExit, captures its PID,
 * and sets a timer to forcibly terminate the process after the audio duration.
 *
 * @param audioFilePath The path to the audio file.
 */
export async function playAudio(audioFilePath: string): Promise<Boolean> {
    // 1. GET AUDIO DURATION
    const absoluteAudioPath = path.resolve(audioFilePath);
    const durationMs = await getAudioDurationMs(absoluteAudioPath);

    try {
        // 2. EXECUTE SCRIPT AND CAPTURE PID
        // Use $ with a promise to capture stdout before the script exits (or hangs).
        setTimeout(async () => {
            const cwd = process.cwd();

            const files = await fs.readdir(cwd);
            const pidFileName = files.find(f => f.endsWith(".pid"));

            if (!pidFileName) {
                throw new Error(`Failed to find a *.pid file in CWD: ${cwd}`);
            }

            const pidString = path.basename(pidFileName, ".pid");
            const pid = parseInt(pidString, 10);

            if (isNaN(pid)) {
                throw new Error(`Invalid PID found in filename: ${pidFileName}`);
            }

            // Clean up the file immediately after getting the PID
            await fs.unlink(path.join(cwd, pidFileName));
            // directory list, get file.pid then delete the file
            await $`taskkill /PID ${pid} /F`.quiet().catch(e => e);
        }, durationMs);

        await $`powershell.exe -NoExit -File ${SCRIPT_PATH} ${absoluteAudioPath}`.quiet().catch(e => e);
        return true

    } catch (error) {
        console.error("Error during audio playback execution:", error);
        return false
    }
}