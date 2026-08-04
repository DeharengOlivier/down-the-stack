import { render } from 'solid-js/web';
import { App } from './ui/App';
import './ui/styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('no #root element to mount into');

render(() => <App />, root);
