import { createEngines } from './types.js';
import { initUI } from './ui.js';
import { showVersion } from './dom.js';
import { VERSION } from './version.js';

showVersion(VERSION);

initUI(createEngines());
