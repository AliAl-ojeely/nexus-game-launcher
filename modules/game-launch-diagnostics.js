'use strict';
// A launch failure is not proof that a game needs administrator privileges.
// Keep this pure so a Windows CreateProcess error cannot produce two dialogs.
function describeLaunchError(error, exePath, gameName = "") {
    const code = typeof error?.code === 'string' ? error.code : 'UNKNOWN';
    const location = String(exePath || 'unknown');
    if (code === 'EACCES' || code === 'EPERM') return {
        code: 'GAME_CREATEPROCESS_DENIED',
        message: 'Windows refused to start this game (' + code + ').\n' +
            'Path: ' + location + '\n' +
            'This does not prove administrator access is needed. Check the EXE manifest, ' +
            'Windows Compatibility > Run this program as administrator, file permissions, and security blocking.\n' +
            'Nexus will NOT elevate automatically. For a read-only diagnosis run:\n' +
            'py -3 tools\\nexus_launch_diagnose.py --game "' +
            String(gameName || 'GAME NAME').replace(/["\r\n]/g, '') + '"'
    };
    if (code === 'ENOENT') return {
        code: 'GAME_FILE_MISSING', message: 'Game executable or required launcher file was not found.\nPath: ' + location
    };
    if (code === 'ENOEXEC') return {
        code: 'GAME_BAD_EXE', message: 'Windows could not execute this file as a program.\nPath: ' + location
    };
    return { code: 'GAME_LAUNCH_FAILED', message: 'Game launch failed (' + code + ').\n' +
        (error?.message || 'Unknown Windows error') + '\nPath: ' + location };
}
module.exports = { describeLaunchError };
