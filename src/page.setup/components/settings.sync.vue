<template lang="pug">
section(ref="el")
  h2
    span {{translate('settings.sync_title')}}
  span.header-shadow
  TextField(
    label="settings.sync_name"
    :or="translate('settings.sync_name_or')"
    v-model:value="Settings.state.syncName"
    @update:value="onSyncNameUpdated")
  ToggleField(
    label="Use Firefox Sync"
    v-model:value="Settings.state.syncUseFirefox"
    @update:value="onFFToggle"
    :note="translate('settings.sync_ff_note')")
  ToggleField(
    label="Use Google Drive (experimental)"
    v-model:value="Settings.state.syncUseGoogleDrive"
    @update:value="onGDToggle"
    :note="translate('settings.sync_gd_note')")

  ToggleField(
    label="settings.sync_save_settings"
    v-model:value="Settings.state.syncSaveSettings"
    @update:value="onSettingsToggle()")
  ToggleField(
    label="settings.sync_save_ctx_menu"
    v-model:value="Settings.state.syncSaveCtxMenu"
    @update:value="onMenuToggle()")
  ToggleField(
    label="settings.sync_save_styles"
    v-model:value="Settings.state.syncSaveStyles"
    @update:value="onStylesToggle()")
  ToggleField(
    label="settings.sync_save_kb"
    v-model:value="Settings.state.syncSaveKeybindings"
    @update:value="onKbToggle()")

  .ctrls
    .btn(@click="openSyncWin") View synced data
</template>

<script lang="ts" setup>
import { ref, onMounted } from 'vue'
import { translate } from 'src/dict'
import { Settings } from 'src/services/settings'
import { Styles } from 'src/services/styles'
import { Menu } from 'src/services/menu'
import { SetupPage } from 'src/services/setup-page'
import TextField from '../../components/text-field.vue'
import ToggleField from '../../components/toggle-field.vue'
import { Keybindings } from 'src/services/keybindings'
import { Logs, Sync } from 'src/services/_services'

const el = ref<HTMLElement | null>(null)

onMounted(() => {
  SetupPage.registerEl('settings_sync', el.value)
})

let onSyncNameUpdatedTimeout: number | undefined
let onSyncNameUpdatedGDTimeout: number | undefined
function onSyncNameUpdated(): void {
  Logs.info('onSyncNameUpdated:', Settings.state.syncName)

  // Save settings
  Settings.saveDebounced(500)

  // Update data in Firefox sync storage
  if (Settings.state.syncUseFirefox) {
    clearTimeout(onSyncNameUpdatedTimeout)
    onSyncNameUpdatedTimeout = setTimeout(async () => {
      Sync.Firefox.updateProfileInfo()
    }, 500)
  }

  // Save new profile data to Google Drive
  if (Settings.state.syncUseGoogleDrive) {
    clearTimeout(onSyncNameUpdatedGDTimeout)
    onSyncNameUpdatedGDTimeout = setTimeout(() => {
      Sync.Google.saveProfileInfo()
    }, 1000)
  }
}

async function onFFToggle() {
  Logs.info('onFFToggle:', Settings.state.syncUseFirefox)

  Settings.saveDebounced(150)

  // Save enabled fields of this profile
  if (Settings.state.syncUseFirefox) {
    if (Settings.state.syncSaveCtxMenu) Menu.saveCtxMenuToSync()
    if (Settings.state.syncSaveKeybindings) Keybindings.saveKeybindingsToSync()
    if (Settings.state.syncSaveStyles) {
      await Styles.loadCustomCSS()
      Styles.saveStylesToSync()
    }
  }

  // Remove enabled fields of this profile
  else {
    if (Settings.state.syncSaveSettings) Sync.Firefox.remove('settings')
    if (Settings.state.syncSaveCtxMenu) Sync.Firefox.remove('ctxMenu')
    if (Settings.state.syncSaveKeybindings) Sync.Firefox.remove('kb')
    if (Settings.state.syncSaveStyles) Sync.Firefox.remove('styles')
  }
}

async function onGDToggle() {
  Logs.info('onGDToggle:', Settings.state.syncUseGoogleDrive)

  Settings.saveDebounced(150)

  // Save enabled fields of this profile
  if (Settings.state.syncUseGoogleDrive) {
    // Save profile info
    await Sync.Google.saveProfileInfo()

    if (Settings.state.syncSaveCtxMenu) Menu.saveCtxMenuToSync()
    if (Settings.state.syncSaveKeybindings) Keybindings.saveKeybindingsToSync()
    if (Settings.state.syncSaveStyles) {
      await Styles.loadCustomCSS()
      Styles.saveStylesToSync()
    }
  }

  // Remove files created from this profile
  else {
    await Sync.Google.removeAllFilesOfThisProfile()
    return
  }
}

function onSettingsToggle(): void {
  Logs.info('onSettingsToggle:', Settings.state.syncSaveSettings)

  if (!Settings.state.syncSaveSettings) {
    Sync.Firefox.remove('settings')
    if (Settings.state.syncUseGoogleDrive) {
      Sync.Google.remove(Sync.Google.FileType.Settings)
    }
  }
  Settings.saveDebounced(150)
}

function onMenuToggle(): void {
  Logs.info('onMenuToggle:', Settings.state.syncSaveCtxMenu)

  if (Settings.state.syncSaveCtxMenu) {
    Menu.saveCtxMenuToSync()
  } else {
    Sync.Firefox.remove('ctxMenu')
    if (Settings.state.syncUseGoogleDrive) {
      Sync.Google.remove(Sync.Google.FileType.CtxMenu)
    }
  }
  Settings.saveDebounced(150)
}

async function onStylesToggle(): Promise<void> {
  Logs.info('onStylesToggle:', Settings.state.syncSaveStyles)

  if (Settings.state.syncSaveStyles) {
    await Styles.loadCustomCSS()
    Styles.saveStylesToSync()
  } else {
    Sync.Firefox.remove('styles')
    if (Settings.state.syncUseGoogleDrive) {
      Sync.Google.remove(Sync.Google.FileType.Styles)
    }
  }

  Settings.saveDebounced(150)
}

function onKbToggle(): void {
  Logs.info('onKbToggle:', Settings.state.syncSaveKeybindings)

  if (Settings.state.syncSaveKeybindings) {
    Keybindings.saveKeybindingsToSync()
  } else {
    Sync.Firefox.remove('kb')
    if (Settings.state.syncUseGoogleDrive) {
      Sync.Google.remove(Sync.Google.FileType.Keybindings)
    }
  }

  Settings.saveDebounced(150)
}

function openSyncWin() {
  Logs.info('settings.sync.vue: openSyncWin()')

  Sync.openSyncWindow()
}
</script>
