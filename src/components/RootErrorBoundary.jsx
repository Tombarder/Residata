import { Component } from 'react'

/**
 * Top-level error boundary — wraps the ENTIRE app (App + every context provider),
 * so an uncaught render error anywhere (marketing pages, a provider, App itself)
 * shows a branded recovery screen instead of a blank white #root.
 *
 * Deliberately self-contained: inline styles only (no dependency on index.css,
 * which may itself be the failure), and no context hooks (it sits OUTSIDE the
 * providers it must be able to catch). Language is read from localStorage /
 * navigator directly for the same reason.
 */
class RootErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { err: null }
  }

  static getDerivedStateFromError(err) {
    return { err }
  }

  componentDidCatch(err, info) {
    // eslint-disable-next-line no-console
    console.error('[RootErrorBoundary]', err, info)
  }

  render() {
    if (!this.state.err) return this.props.children

    let sk = false
    try {
      const stored = localStorage.getItem('lang') || localStorage.getItem('residata_lang')
      sk = stored ? stored.startsWith('sk') : (navigator.language || '').startsWith('sk')
    } catch (_) { /* localStorage may be unavailable */ }

    const msg = String(this.state.err?.message || this.state.err || 'Unknown error')

    return (
      <div style={{
        minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'var(--bg)', color: 'var(--text)', fontFamily: 'system-ui, -apple-system, sans-serif',
        padding: '2rem',
      }}>
        <div style={{ maxWidth: 560, textAlign: 'left' }}>
          <div style={{ fontSize: '2rem', marginBottom: '1rem' }}>⚠️</div>
          <h1 style={{ fontSize: '1.35rem', fontWeight: 700, margin: '0 0 0.6rem' }}>
            {sk ? 'Niečo sa pokazilo' : 'Something went wrong'}
          </h1>
          <p style={{ color: 'var(--text-dim)', fontSize: '0.95rem', lineHeight: 1.6, margin: '0 0 1.25rem' }}>
            {sk
              ? 'Ospravedlňujeme sa — stránku sa nepodarilo načítať. Skús ju obnoviť; ak problém pretrváva, daj nám vedieť.'
              : "Sorry — this page failed to load. Try reloading; if it keeps happening, let us know."}
          </p>
          <pre style={{
            background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 6,
            padding: '0.7rem 0.9rem', fontFamily: 'monospace', fontSize: '0.72rem',
            color: '#ff9aa2', overflowX: 'auto', margin: '0 0 1.25rem',
          }}>{msg}</pre>
          <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
            <button
              onClick={() => window.location.reload()}
              style={{
                background: '#7cf5b0', color: '#06251a', border: 0, borderRadius: 6,
                padding: '0.6rem 1.1rem', fontSize: '0.88rem', fontWeight: 600, cursor: 'pointer',
              }}>
              {sk ? 'Obnoviť stránku' : 'Reload page'}
            </button>
            <button
              onClick={() => window.location.assign('/')}
              style={{
                background: 'transparent', color: 'var(--text)', border: '1px solid #333',
                borderRadius: 6, padding: '0.6rem 1.1rem', fontSize: '0.88rem', cursor: 'pointer',
              }}>
              {sk ? 'Domov' : 'Home'}
            </button>
          </div>
        </div>
      </div>
    )
  }
}

export default RootErrorBoundary
