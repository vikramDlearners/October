// Where the Node proxy lives. Same origin when the Node server serves the page; a static dev server on 5173 talks to the backend on 3000.
export const API_ORIGIN =
  location.hostname.endsWith('github.io') ? 'https://sloth-trip-watcher.onrender.com'
  : location.port === '5173' ? `${location.protocol}//${location.hostname}:3000`
  : '';
