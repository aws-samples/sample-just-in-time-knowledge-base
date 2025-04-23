// src/polyfills.js
import { Buffer } from 'buffer';

if (typeof global === 'undefined') {
    window.global = window;
}

window.Buffer = Buffer;
window.process = { env: {} };