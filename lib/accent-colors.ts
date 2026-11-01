export const ACCENT_STORAGE_KEY = 'bilms-accent-color'

export const accentColors = [
  { name: 'Marine', value: '#1a3c72' },
  { name: 'Or', value: '#c9952f' },
  { name: 'Forêt', value: '#1f7a4d' },
  { name: 'Bordeaux', value: '#8c2f39' },
  { name: 'Violet', value: '#5b3a8e' },
  { name: 'Sarcelle', value: '#0f7a72' },
] as const

export function applyAccentColor(value: string) {
  document.documentElement.style.setProperty('--primary', value)
}
