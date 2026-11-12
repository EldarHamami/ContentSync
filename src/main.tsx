import { render } from 'preact';
import { App } from './ui/App';
import './styles.css';

declare const __SINGLE__: boolean;

if (!__SINGLE__) document.documentElement.classList.add('standalone');

render(<App />, document.getElementById('app')!);

if (!__SINGLE__ && 'serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('./sw.js').catch(() => undefined);
}
