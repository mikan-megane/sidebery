import { InstanceType } from 'src/types'
import * as IPC from 'src/services/ipc'
import { Info } from 'src/services/info'
import { Settings } from 'src/services/settings'
import { Styles } from 'src/services/styles'
import { Windows } from 'src/services/windows'
import { Logs } from 'src/services/_services'

const VERTICAL_MARGINS = 22
const el = document.getElementById('textInput') as HTMLInputElement | null

el?.focus()

el?.addEventListener('blur', () => {
  if (Windows.id !== undefined) IPC.sendToSidebar(Windows.id, 'onOutsideEditingExit')
})

let ctxMenuKeyPressed: number | undefined
el?.addEventListener('keydown', (e: KeyboardEvent) => {
  // Enter
  if (e.key === 'Enter' && !e.altKey) {
    e.preventDefault()
    if (Windows.id !== undefined) IPC.sendToSidebar(Windows.id, 'onOutsideEditingEnter')
  }
})

el?.addEventListener('contextmenu', (e: Event) => {
  if (ctxMenuKeyPressed !== undefined) e.preventDefault()
})

el?.addEventListener('input', (e: Event) => {
  if (Windows.id !== undefined) IPC.sendToSidebar(Windows.id, 'onOutsideEditingInput', el.value)
})

function closePopup(): void {
  window.close()
}

void (async () => {
  Info.setInstanceType(InstanceType.editing)
  Logs.setInstanceType(InstanceType.editing)
  IPC.setInstanceType(InstanceType.editing)
  IPC.setupGlobalMessageListener()
  IPC.registerActions({ closePopup })

  const sp = new URLSearchParams(document.location.search)
  const winIdStr = sp.get('winId')
  if (!winIdStr) return

  const winId = parseInt(winIdStr)
  if (isNaN(winId)) return

  const value = sp.get('value')
  if (value && el) {
    el.value = value

    // 1px less, so later I can update height to fix graphical glitches
    el.style.height = `${el.scrollHeight - VERTICAL_MARGINS - 1}px`
  }

  const placeholder = sp.get('placeholder')
  if (placeholder && el) el.placeholder = placeholder

  if (winId !== undefined) {
    IPC.setWinId(winId)
    Windows.id = winId
    IPC.connectTo(InstanceType.sidebar, Windows.id)
  }

  Settings.loadSettings().then(() => Styles.initColorScheme())

  setTimeout(() => {
    if (el) {
      // Focus input again, although there are still cases of popups with no focus
      // https://bugzilla.mozilla.org/show_bug.cgi?id=1918031
      el.focus()
      el.select()

      // Update height to fix graphical glitches
      el.style.height = `${el.scrollHeight - VERTICAL_MARGINS}px`
    }
  }, 3)

  setTimeout(() => {
    // And again...
    if (el) {
      el.focus()
      el.select()
    }
  }, 250)
})()
