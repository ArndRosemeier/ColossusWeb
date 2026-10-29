import { setPresentationMode, usePresentationMode } from '../ui/presentationMode'

export function PresentationModeSelect({ className, showBlurb = false }: { className?: string; showBlurb?: boolean }) {
  const mode = usePresentationMode()
  return (
    <label className={className ?? 'bg-atmosphere-select'}>
      <span className="muted">Presentation</span>
      <select aria-label="Presentation mode" title="Animated artwork covers the 24 standard creatures in battles. Other creatures use classic counters. Reduced motion uses still artwork." value={mode} onChange={event => {
        const value = event.target.value
        if (value === 'classic' || value === 'animated') setPresentationMode(value)
      }}>
        <option value="classic">Classic</option>
        <option value="animated">Animated</option>
      </select>
      {showBlurb && <p className="hint">Animated mode brings color and motion to the 24 standard creatures in battles. Other creatures keep classic counters. Reduced motion uses still artwork.</p>}
    </label>
  )
}
