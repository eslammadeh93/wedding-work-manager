import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { sanitizeText } from './utils/security';

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
