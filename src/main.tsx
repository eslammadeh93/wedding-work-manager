import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { sanitizeText } from './utils/security';
import { registerPwa } from './pwa';

// Show the app with system fonts immediately, even on a slow Google Fonts connection.
const fonts = document.getElementById('app-fonts') as HTMLLinkElement | null;
if (fonts?.sheet) fonts.media = 'all';
else fonts?.addEventListener('load', () => { fonts.media = 'all'; }, { once: true });

// Safari's gesture events supplement touch-action for the app's fixed scale.
// Single-finger scrolling and all keyboard/input events remain untouched.
const preventPinchZoom = (event: Event) => event.preventDefault();
document.addEventListener('gesturestart', preventPinchZoom, { passive: false });
document.addEventListener('gesturechange', preventPinchZoom, { passive: false });

// Clean script-like content while it is being typed in regular text fields.
// Passwords are intentionally excluded so users can choose any valid password.
document.addEventListener('input', (event) => {
  const target = event.target;
  if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) return;
  if (target instanceof HTMLInputElement && ['password', 'number', 'date', 'checkbox', 'radio'].includes(target.type)) return;
  const cleanValue = sanitizeText(target.value);
  if (cleanValue !== target.value) target.value = cleanValue;
}, true);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

registerPwa();
