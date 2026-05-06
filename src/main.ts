import { mount } from 'svelte'
import './app.css'
import App from './App.svelte'

// Request persistent storage so the browser won't evict IndexedDB data
// automatically under low-disk conditions. Granted automatically for
// installed PWAs on Chrome/Android; iOS protects installed PWA storage
// independently of this API.
navigator.storage?.persist?.();

const app = mount(App, {
  target: document.getElementById('app')!,
})

export default app
