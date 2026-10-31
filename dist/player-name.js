export const PLAYER_NAME_KEY = 'quizrow.playerName';

function cleanName(value) {
  return typeof value === 'string' ? value.replace(/[\x00-\x1f\x7f]/g, '').trim().slice(0, 22) : '';
}

export function readPlayerName(storage) {
  try { return cleanName((storage ?? globalThis.localStorage).getItem(PLAYER_NAME_KEY)); }
  catch { return ''; }
}

export function savePlayerName(name, storage) {
  try {
    const target = storage ?? globalThis.localStorage, value = cleanName(name);
    if (value) target.setItem(PLAYER_NAME_KEY, value);
    else target.removeItem(PLAYER_NAME_KEY);
  } catch { /* A disabled or full store must not prevent playing. */ }
}
