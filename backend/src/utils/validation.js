import { ValidationError } from './errors.js';

/** Whether `id` can be a Payload document id (serial integers on Postgres). */
export const isDocId = (id) => /^[1-9]\d{0,15}$/.test(String(id ?? ''));

/**
 * A list of identifier-like names (extension names, module names…): an array of strings,
 * each matching `pattern`, at most `max` after trimming, `normalize` and removing duplicates.
 */
export function sanitizeNameList(value, {
    label = 'List', max = 50, pattern = /^[\w.-]{1,100}$/, normalize = (s) => s,
} = {}) {
    if (value == null) return [];
    if (!Array.isArray(value)) throw new ValidationError(`${label} must be a list`);
    const names = [...new Set(value.map((v) => normalize(String(v ?? '').trim())).filter(Boolean))];
    const bad = names.find((n) => !pattern.test(n));
    if (bad) throw new ValidationError(`${label} has an invalid name: ${bad.slice(0, 100)}`);
    if (names.length > max) throw new ValidationError(`${label} can have at most ${max} entries`);
    return names;
}

/**
 * File extensions, stored lowercase without "*." or "." ("*.MRB" → "mrb"); multi-part ones such
 * as "nii.gz" or "seg.nrrd" are kept whole.
 */
export const sanitizeFileExtensions = (value, { label = 'File types', max = 30 } = {}) => sanitizeNameList(value, {
    label,
    max,
    pattern: /^[a-z0-9]+(\.[a-z0-9]+){0,3}$/,
    normalize: (s) => s.toLowerCase().replace(/^\*?\./, ''),
});

/** Trimmed text; `required` rejects empty, longer than `max` is rejected. */
export function sanitizeText(value, { label = 'Text', max = 200, required = false } = {}) {
    const text = String(value ?? '').trim();
    if (required && !text) throw new ValidationError(`${label} is required`);
    if (text.length > max) throw new ValidationError(`${label} can be at most ${max} characters`);
    return text;
}

/** One of `allowed`, else a ValidationError. */
export function sanitizeChoice(value, allowed, { label = 'Value' } = {}) {
    if (!allowed.includes(value)) throw new ValidationError(`${label} must be one of: ${allowed.join(', ')}`);
    return value;
}
