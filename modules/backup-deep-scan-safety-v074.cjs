'use strict';
// Read-only gate: a game installation is never a backup save-directory candidate.
const fs = require('node:fs');
const path = require('node:path');

function absolute(p) {
  if (typeof p !== 'string' || !p || !path.isAbsolute(p) || /[\r\n\0]/.test(p)) return '';
  return path.resolve(p);
}
function contains(parent, child) {
  const a = absolute(parent), b = absolute(child);
  if (!a || !b) return false;
  const relative = path.relative(a, b);
  return relative === '' || (relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative));
}
function stat(p) { try { return fs.lstatSync(p); } catch { return null; } }
function isFileExecutable(p) { return /\.(?:exe|bat|cmd|com|msi)$/i.test(path.basename(p)); }
function executableInDirectory(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).some(e => e.isFile() && isFileExecutable(e.name));
  } catch { return false; }
}
function exclusionReason(game, candidatePath, source = '') {
  const candidate = absolute(candidatePath);
  if (!candidate) return 'INVALID_ABSOLUTE_PATH';
  if (path.parse(candidate).root === candidate) return 'VOLUME_ROOT';
  const candidateStat = stat(candidate);
  if (!candidateStat || candidateStat.isSymbolicLink()) return 'NOT_A_REGULAR_PATH';
  if (candidateStat.isFile()) return isFileExecutable(candidate) ? 'EXECUTABLE_FILE' : '';
  if (!candidateStat.isDirectory()) return 'NOT_A_REGULAR_PATH';
  const executable = absolute(game?.path);
  // Any folder containing the launched executable (including parents) is too broad.
  if (executable && contains(candidate, executable)) return 'INSTALL_ROOT_OR_PARENT';
  // A folder with an executable directly inside is not save-only evidence.
  if (source === 'deep-scan-match' && executableInDirectory(candidate)) return 'EXECUTABLE_DIRECTORY';
  return '';
}
module.exports = { exclusionReason, contains };
