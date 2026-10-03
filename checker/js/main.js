import { createEngines } from './types.js';
import { initUI } from './ui.js';
import { requireLogin, logout, PASS_HASH } from './auth.js';
import { showVersion } from './dom.js';
import { VERSION } from './version.js';

showVersion(VERSION);

requireLogin().then(() => {
  const out = document.getElementById('logout');
  out.hidden = !PASS_HASH;
  out.onclick = logout;
  initUI(createEngines());
});
