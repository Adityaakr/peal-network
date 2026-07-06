import './style.css';
import { renderHome } from './pages/home';
import { renderCondition } from './pages/condition';

type Cleanup = () => void;

let cleanup: Cleanup | null = null;

function route(): void {
  if (cleanup) cleanup();
  const root = document.getElementById('app');
  if (!root) return;
  root.innerHTML = '';
  const hash = location.hash || '#/';
  const match = hash.match(/^#\/condition\/(.+)$/);
  if (match) {
    cleanup = renderCondition(root, decodeURIComponent(match[1]));
  } else {
    cleanup = renderHome(root);
  }
}

window.addEventListener('hashchange', route);
route();
