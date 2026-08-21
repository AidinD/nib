import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from './app/App'
import { StickyWindow } from './sticky/StickyWindow'
import './styles.css'

/**
 * One renderer bundle, two window types. The hash is what tells them apart:
 * `#sticky/<noteId>` is a sticky, anything else is the main window.
 */
function Root(): React.JSX.Element {
  const match = /^#sticky\/([A-Za-z0-9_-]+)$/.exec(window.location.hash)
  if (match !== null) {
    document.body.classList.add('is-sticky-window')
    return <StickyWindow noteId={match[1]} />
  }
  return <App />
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
)
