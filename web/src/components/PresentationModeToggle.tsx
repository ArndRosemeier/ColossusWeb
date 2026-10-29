import { setPresentationMode, usePresentationMode } from '../ui/presentationMode'

/** One native checkbox for the shared local presentation preference. */
export function PresentationModeToggle({ className }: { className?: string }) {
  const mode = usePresentationMode()
  return (
    <label className={`presentation-mode-toggle${className ? ` ${className}` : ''}`}
      title="Colored creature artwork and subtle main-board landscapes. Uncheck for Classic. Reduced motion uses still artwork.">
      <input type="checkbox" aria-label="Animated mode" checked={mode === 'animated'}
        onChange={event => setPresentationMode(event.currentTarget.checked ? 'animated' : 'classic')} />
      <span>Animated mode</span>
    </label>
  )
}
