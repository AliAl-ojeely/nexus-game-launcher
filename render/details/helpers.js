import { userSettings } from '../state.js';

export function t(key, fallback = '') {
    const lang = userSettings.lang;
    return (dictionary[lang] && dictionary[lang][key]) || fallback;
}