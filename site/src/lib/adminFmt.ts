/** a time for the admin's lists, in Israel's time zone */
export const fmt = (ms: number) => (ms ? new Date(ms).toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem', dateStyle: 'short', timeStyle: 'short' }) : '');
