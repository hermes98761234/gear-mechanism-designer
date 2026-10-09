import { useEffect, useState } from 'react'
import { loadState, saveState, type AppState, type Tab } from './lib/model'
import { tr, type T } from './i18n'
import GearTab from './components/GearTab'
import LinkageTab from './components/LinkageTab'
import CamTab from './components/CamTab'

const TABS: { id: Tab; label: string }[] = [
  { id: 'gears', label: 'Involute gears' },
  { id: 'linkage', label: 'Linkages' },
  { id: 'cam', label: 'Cams' },
]

export default function App() {
  const [state, setState] = useState<AppState>(loadState)
  const t: T = (s, ...a) => tr(state.lang, s, ...a)
  const update = (patch: Partial<AppState>) => setState((s) => ({ ...s, ...patch }))

  useEffect(() => saveState(state), [state])
  useEffect(() => {
    const root = document.documentElement
    if (state.theme === 'auto') delete root.dataset.theme
    else root.dataset.theme = state.theme
    root.lang = state.lang
  }, [state.theme, state.lang])

  return (
    <div className="app">
      <header className="toolbar">
        <span className="brand">{t('Gear and mechanism designer')}</span>
        <nav className="tabs" role="tablist" aria-label={t('Tools')}>
          {TABS.map((tab) => (
            <button key={tab.id} role="tab" aria-selected={state.tab === tab.id} className={state.tab === tab.id ? 'active' : ''} onClick={() => update({ tab: tab.id })}>
              {t(tab.label)}
            </button>
          ))}
        </nav>
        <span className="spacer" />
        <label className="inline">
          {t('Language')}
          <select value={state.lang} onChange={(e) => update({ lang: e.target.value as AppState['lang'] })}>
            <option value="en">English</option>
            <option value="uk">Українська</option>
          </select>
        </label>
        <label className="inline">
          {t('Theme')}
          <select value={state.theme} onChange={(e) => update({ theme: e.target.value as AppState['theme'] })}>
            <option value="auto">{t('System')}</option>
            <option value="light">{t('Light')}</option>
            <option value="dark">{t('Dark')}</option>
          </select>
        </label>
      </header>
      {state.tab === 'gears' && <GearTab g={state.gear} t={t} onChange={(gear) => update({ gear })} />}
      {state.tab === 'linkage' && <LinkageTab l={state.link} t={t} onChange={(link) => update({ link })} />}
      {state.tab === 'cam' && <CamTab c={state.cam} t={t} onChange={(cam) => update({ cam })} />}
      <p className="hint foot">
        {t('Everything runs in your browser. Nothing is uploaded.')}{' '}
        <a href="https://github.com/hermes98761234/gear-mechanism-designer">{t('Source on GitHub')}</a>
      </p>
    </div>
  )
}
