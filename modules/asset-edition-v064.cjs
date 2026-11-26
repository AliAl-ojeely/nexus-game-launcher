'use strict';
// User qualifiers are search intent, never a new stored game name or provider ID.
const { titleTokens, cleanTitle } = require('./asset-resolver');
const { titleAndYear } = require('./asset-sgdb-identity-v062.cjs');
const QUALIFIER = /(?:\s*[\[(](unofficial\s+pc\s+port|native\s+pc\s+port|fan(?:made)?\s+pc\s+port|pc\s+port|remake|remaster(?:ed)?|original(?:\s+release)?)[\])]|\s+[-\u2013\u2014]\s+(unofficial\s+pc\s+port|native\s+pc\s+port|pc\s+port|remake|remaster(?:ed)?|original(?:\s+release)?)|\s+(unofficial\s+pc\s+port|native\s+pc\s+port|pc\s+port|remake|remaster(?:ed)?))\s*$/i;
const key = value => titleTokens(value).join(' ');
function parseLabel(value) {
    const original = String(value || '').normalize('NFKC').trim();
    let base = cleanTitle(original), year = null, port = false, edition = null, conflict = false;
    for (let i = 0; i < 5; i++) {
        const parsed = titleAndYear(base);
        if (parsed.year) {
            if (year !== null) { conflict = true; break; }
            year = parsed.year; base = parsed.title; continue;
        }
        const match = QUALIFIER.exec(base);
        if (!match) break;
        const marker = (match[1] || match[2] || match[3]).toLowerCase();
        if (/pc\s+port$/.test(marker)) port = true;
        else {
            const next = marker.startsWith('remaster') ? 'remaster' : marker.startsWith('original') ? 'original' : 'remake';
            if (edition && edition !== next) conflict = true;
            edition = next;
        }
        base = base.slice(0, match.index).trim();
    }
    // Combined qualifiers require an explicit catalog selection, not a guess.
    if (port && edition) conflict = true;
    return { original, base, year, port, edition, conflict, key: key(base) };
}

// Only provider-owned title labels or explicit self-descriptions count. A later
// date, popularity, platform alone or a mention of another remake is not proof.
function editionEvidence(row, base) {
    const p = parseLabel(row?.name);
    if (p.conflict) return null;
    if (p.key === key(base) && p.edition) return p.edition;
    const desc = String(row?.description_raw || '').slice(0, 16000);
    if (!desc || !base) return null;
    const title = key(base);
    const evidence = new Set();
    // Limit to an explicit relation to this title in the same sentence.
    for (const sentence of desc.split(/[.!?\n]+/).slice(0, 40)) {
        const words = key(sentence);
        const relation = /(?:^|\b(?:is|comes|represents) )(?:(?:a|the) )?(?:(?:complete|full|faithful|ground up) )?(remake|remaster|remastered version) of\b/g;
        for (const m of words.matchAll(relation)) {
            const tail = words.slice(m.index + m[0].length).trim();
            // Allow short introductory words, e.g. 'the PlayStation classic'.
            // Require the complete title in the following bounded context.
            const beforeTitle = tail.indexOf(title);
            if (beforeTitle >= 0 && beforeTitle <= 80 && (` ${tail} `).includes(` ${title} `) && tail.endsWith(title)) {
                const prefix = tail.slice(0, beforeTitle);
                if (prefix.split(' ').filter(Boolean).length <= 8 && !/\b(?:and|or|sequel|inspired|not)\b/.test(prefix))
                    evidence.add(m[1] === 'remake' ? 'remake' : 'remaster');
            }
        }
    }
    return evidence.size === 1 ? [...evidence][0] : null;
}

// Explicit port year describes the local build, not a store release. Only a
// unique earlier dated base is automatic; multiple earlier editions need a picker.
function portCandidate(q, matches, complete) {
    if (!q.port || q.conflict || !complete) return null;
    const bases = matches.filter(x => !x.rowPort && (!x.rowEdition || x.rowEdition === 'original') && x.year);
    if (matches.some(x => !x.year)) return null;
    const eligible = q.year ? bases.filter(x => x.year < q.year) : bases;
    return eligible.length === 1 ? eligible[0] : null;
}

function selectEdition(q, matches, complete) {
    if (!q.edition || q.conflict || !complete || !matches.length) return null;
    const relevant = matches.filter(x => !x.rowPort && (!q.year || x.year === q.year));
    const proven = relevant.filter(x => editionEvidence(x.row, q.base) === q.edition);
    if (proven.length === 1) {
        // An unclassified same-title result could be the same edition.
        // Require positive evidence for the chosen entry, and reject duplicate
        // positives. Unknown competing entries do not imply a later-year rule.
        return proven[0];
    }
    if (q.edition === 'original' && q.year && relevant.length === 1 && !editionEvidence(relevant[0].row, q.base)) return relevant[0];
    if (q.edition === 'original' && !proven.length && !q.year && relevant.length >= 2) {
        const unclassified = relevant.filter(x => !editionEvidence(x.row, q.base));
        if (unclassified.length === 1 && unclassified[0].year && relevant.every(x => x === unclassified[0] ||
            (x.year > unclassified[0].year && ['remake','remaster'].includes(editionEvidence(x.row, q.base)))))
            return unclassified[0];
    }
    return null;
}

// Search suggestions are NOT identities. Do not auto-download a subtitle,
// collection, expansion or differently numbered sequel on this evidence.
function relatedCandidates(q, rows) {
    const out = new Map();
    if (!q.key || q.conflict) return [];
    for (const row of Array.isArray(rows) ? rows : []) {
        const id = String(row?.id ?? '');
        if (!/^\d{1,12}$/.test(id) || out.has(id)) continue;
        const p = parseLabel(row.name);
        if (!p.key) continue;
        const types = Array.isArray(row.types) ? row.types.map(x => String(x).toLowerCase()) : [];
        if (types.some(t => ['movie','film','video','soundtrack','music','book','trailer'].includes(t)) || /\b(?:soundtrack|ost|trailer)\s*$/i.test(String(row.name))) continue;
        let reason;
        if (p.key === q.key) reason = 'same_title_release';
        else if (p.key.replace(/ /g,'') === q.key.replace(/ /g,'')) reason = 'compound_spacing';
        else if (p.key.startsWith(q.key + ' ') && /[:\u2013\u2014]|\s-\s|\bcollection\b/i.test(String(row.name)) &&
            !/^\d+\b/.test(p.key.slice(q.key.length+1))) reason = 'related_subtitle';
        else continue;
        const date = row.released ?? row.release_date;
        const { releaseYear } = require('./asset-sgdb-identity-v062.cjs');
        out.set(id, { id, name: String(row.name).replace(/[\x00-\x1f\x7f]/g,' ').slice(0,240), releaseYear: p.year || releaseYear(date), reason,
            edition: p.edition || null });
        if (out.size >= 8) break;
    }
    return [...out.values()];
}
module.exports = { parseLabel, editionEvidence, portCandidate, selectEdition, relatedCandidates };
