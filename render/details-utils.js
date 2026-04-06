// // ─────────────────────────────────────────────────────────────────────────────
// // HELPER FUNCTIONS
// // ─────────────────────────────────────────────────────────────────────────────

// // يحوّل backslashes لـ forward slashes عشان المتصفح يقبل المسار
// export function toSafeUrl(url) {
//     if (!url) return '';

//     // إذا كان الرابط http أو https لا نلمسه
//     if (url.startsWith('http')) return url;

//     // تحويل Windows path إلى URL صالح
//     const normalized = url.replace(/\\/g, '/');

//     // إذا كان البروتوكول موجود لا نضيفه مرة أخرى
//     if (normalized.startsWith('local-resource://')) return normalized;

//     return `local-resource://${encodeURI(normalized)}`;
// }

// export function formatTime(totalSeconds) {
//     const h = Math.floor(totalSeconds / 3600).toString().padStart(2, '0');
//     const m = Math.floor((totalSeconds % 3600) / 60).toString().padStart(2, '0');
//     const s = (totalSeconds % 60).toString().padStart(2, '0');
//     return `${h}:${m}:${s}`;
// }

// export function formatPlaytime(totalMinutes, lang) {
//     const totalMinsInt = Math.floor(totalMinutes);
//     const hours = Math.floor(totalMinsInt / 60);
//     const mins = totalMinsInt % 60;
//     const hLabel = lang === 'ar' ? 'س' : 'h';
//     const mLabel = lang === 'ar' ? 'د' : 'm';
//     if (hours === 0) return `${mins}${mLabel}`;
//     return `${hours}${hLabel} ${mins}${mLabel}`;
// }

// export const isValid = (val) =>
//     val != null &&
//     val !== 'N/A' &&
//     val !== 'Not Available' &&
//     val !== 'Loading...' &&
//     String(val).trim() !== '';

// ─────────────────────────────────────────────────────────────────────────────
// HELPER FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────

export function toSafeUrl(url) {
    if (!url) return '';

    // روابط http/https لا نلمسها
    if (url.startsWith('http')) return url;

    // توحيد الـ backslashes
    const normalized = url.replace(/\\/g, '/');

    // إذا البروتوكول موجود بالصيغة الصحيحة local-resource:///
    if (normalized.startsWith('local-resource:///')) return normalized;

    // إذا كان local-resource:// (بدون /) نصحح
    if (normalized.startsWith('local-resource://')) {
        return normalized.replace('local-resource://', 'local-resource:///');
    }

    return normalized;
}

export function formatTime(totalSeconds) {
    const h = Math.floor(totalSeconds / 3600).toString().padStart(2, '0');
    const m = Math.floor((totalSeconds % 3600) / 60).toString().padStart(2, '0');
    const s = (totalSeconds % 60).toString().padStart(2, '0');
    return `${h}:${m}:${s}`;
}

export function formatPlaytime(totalMinutes, lang) {
    const totalMinsInt = Math.floor(totalMinutes);
    const hours = Math.floor(totalMinsInt / 60);
    const mins = totalMinsInt % 60;
    const hLabel = lang === 'ar' ? 'س' : 'h';
    const mLabel = lang === 'ar' ? 'د' : 'm';
    if (hours === 0) return `${mins}${mLabel}`;
    return `${hours}${hLabel} ${mins}${mLabel}`;
}

export const isValid = (val) =>
    val != null &&
    val !== 'N/A' &&
    val !== 'Not Available' &&
    val !== 'Loading...' &&
    String(val).trim() !== '';