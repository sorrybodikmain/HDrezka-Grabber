// Глобальні змінні для popup
let popupDataVideo = {}
let popupDataPlayer = {}
let popupDisplaySettings = {}
const popupCurrentTab = {
  id: null,
  isHdrezka: false,
}

// Ініціалізація popup
;(async () => {
  try {
    popupCurrentTab.id = await getCurrentTabId()
    if (!popupCurrentTab.id) {
      console.error('No active tab found')
      return
    }

    const targetTab = { tabId: popupCurrentTab.id, allFrames: false }

    const result = await chrome.scripting.executeScript({
      target: targetTab,
      func: isTargetSite,
    })

    popupCurrentTab.isHdrezka = result[0].result
    console.log('isHDrezka = ' + popupCurrentTab.isHdrezka)

    if (!popupCurrentTab.isHdrezka) {
      console.log('Not on HDrezka site')
      return
    }

    const videoResult = await chrome.scripting.executeScript({
      target: targetTab,
      func: getDataVideo,
    })

    setDataVideo(videoResult[0].result)

    if (popupDataVideo.action === 'get_stream') {
      showCheckBox()
      const playerResult = await chrome.scripting.executeScript({
        target: targetTab,
        func: getSettingsPlayer,
      })
      setSettingsPlayer(playerResult[0].result)
    }

    await synchData()

    if (popupDataVideo.action === 'get_stream') {
      displayValuesSeason()
    } else {
      displayQuality()
    }

    if (Object.keys(popupDisplaySettings).length === 0) {
      await saveCurrentSettings()
    } else {
      displayCurrentSettings()
    }
  } catch (error) {
    console.error('Popup initialization error:', error)
  }
})()

async function getCurrentTabId() {
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true })
    if (tabs && tabs.length > 0) {
      return tabs[0].id
    }
    return null
  } catch (error) {
    console.error('Error getting current tab:', error)
    return null
  }
}

function isTargetSite() {
  return new Promise(resolve => {
    try {
      const nameSite = document.querySelector('meta[property="og:site_name"]')
      resolve(nameSite && nameSite.content === 'rezka.ag')
    } catch (error) {
      console.error('Error checking target site:', error)
      resolve(false)
    }
  })
}

function getDataVideo() {
  return new Promise(resolve => {
    try {
      console.log('load video_info start')
      const script = document.createElement('script')
      script.src = chrome.runtime.getURL(
        'src/js/injection_scripts/video_info.js',
      )
      document.documentElement.appendChild(script)

      const intervalId = setInterval(() => {
        if (script.dataset.result !== undefined) {
          clearInterval(intervalId)
          try {
            const result = JSON.parse(script.dataset.result)
            document.documentElement.removeChild(script)
            console.log('load video_info end succ')
            resolve(result)
          } catch (error) {
            console.error('Error parsing video info:', error)
            resolve({})
          }
        }
      }, 30)

      // Timeout після 10 секунд
      setTimeout(() => {
        clearInterval(intervalId)
        if (script.parentNode) {
          document.documentElement.removeChild(script)
        }
        console.error('Video info loading timeout')
        resolve({})
      }, 10000)
    } catch (error) {
      console.error('Error in getDataVideo:', error)
      resolve({})
    }
  })
}

function setDataVideo(frames) {
  if (!frames || typeof frames !== 'object') {
    console.error('Invalid frames data:', frames)
    return
  }

  popupDataVideo = {
    film_id: frames.film_id || '',
    translator_id: frames.translator_id || '',
    season_id: frames.season_id || '',
    episode_id: frames.episode_id || '',
    action: frames.action || '',
    filename: frames.filename || '',
    quality: frames.quality || '',
  }

  if (frames.qualities && Array.isArray(frames.qualities)) {
    popupDataPlayer.qualities = frames.qualities
  } else {
    popupDataPlayer.qualities = []
  }
}

function getSettingsPlayer() {
  return new Promise(resolve => {
    try {
      const dictionary = {
        translators: {},
        seasons: [],
        episodes: {},
      }

      // Отримати перекладачів
      document.querySelectorAll('.b-translator__item').forEach(item => {
        const title = item.title || item.textContent.trim()
        const translatorId = item.getAttribute('data-translator_id')
        if (title && translatorId) {
          dictionary.translators[title] = translatorId
        }
      })

      // Якщо перекладачів не знайдено, спробувати альтернативний метод
      if (Object.keys(dictionary.translators).length === 0) {
        const elements = document.querySelectorAll('td.l h2')
        const filteredElements = Array.from(elements).filter(element =>
          element.textContent.includes('В переводе'),
        )

        if (filteredElements.length > 0) {
          const match = document.documentElement.outerHTML.match(
            /sof\.tv\.([^.]*)\((\d+), (\d+), (\d+), (\d+)/,
          )
          if (
            match &&
            filteredElements[0].parentNode &&
            filteredElements[0].parentNode.nextElementSibling
          ) {
            const translatorName =
              filteredElements[0].parentNode.nextElementSibling.textContent.trim()
            dictionary.translators[translatorName] = match[3]
          }
        }
      }

      // Отримати сезони
      document.querySelectorAll('.b-simple_season__item').forEach(item => {
        const seasonId = item.getAttribute('data-tab_id')
        if (seasonId) {
          dictionary.seasons.push(seasonId)
        }
      })

      // Отримати епізоди
      const episodesList = document
        .getElementById('simple-episodes-tabs')
        ?.getElementsByTagName('ul')
      if (episodesList) {
        for (let i = 0; i < episodesList.length; i++) {
          const seasonIdMatch = episodesList[i].getAttribute('id')?.split('-')
          if (seasonIdMatch && seasonIdMatch.length > 3) {
            const seasonId = seasonIdMatch[3]
            const episodes = []
            const episodeItems = episodesList[i].getElementsByTagName('li')

            for (let j = 0; j < episodeItems.length; j++) {
              const episodeId = episodeItems[j].getAttribute('data-episode_id')
              if (episodeId) {
                episodes.push(episodeId)
              }
            }
            dictionary.episodes[seasonId] = episodes
          }
        }
      }

      resolve(dictionary)
    } catch (error) {
      console.error('Error in getSettingsPlayer:', error)
      resolve({ translators: {}, seasons: [], episodes: {} })
    }
  })
}

function setSettingsPlayer(frames) {
  if (!frames || typeof frames !== 'object') {
    console.error('Invalid settings player data:', frames)
    return
  }

  popupDataPlayer.seasons = frames.seasons || []
  popupDataPlayer.episodes = frames.episodes || {}
  popupDataPlayer.translators = frames.translators || {}
}

async function synchData() {
  try {
    const key = popupCurrentTab.id.toString()
    const result = await chrome.storage.local.get([key])

    if (
      result[key] &&
      result[key].dataVideo &&
      result[key].dataVideo.film_id === popupDataVideo.film_id
    ) {
      popupDataPlayer = { ...popupDataPlayer, ...result[key].dataPlayer }
      popupDisplaySettings = result[key].displaySettings || {}
    }

    await clearOldData()
    await saveData()
  } catch (error) {
    console.error('Error in synchData:', error)
  }
}

async function clearOldData() {
  try {
    let lstSavedTab = Object.keys(await chrome.storage.local.get(null))
    const lstAllTab = await chrome.tabs.query({})

    lstAllTab.forEach(item => {
      if (lstSavedTab.includes(item.id.toString())) {
        lstSavedTab = lstSavedTab.filter(id_ => id_ !== item.id.toString())
      }
    })

    if (lstSavedTab.length > 0) {
      await chrome.storage.local.remove(lstSavedTab)
    }
  } catch (error) {
    console.error('Error clearing old data:', error)
  }
}

async function saveData() {
  try {
    const key = popupCurrentTab.id.toString()
    await chrome.storage.local.set({
      [key]: {
        dataVideo: popupDataVideo,
        dataPlayer: popupDataPlayer,
        displaySettings: popupDisplaySettings,
      },
    })
  } catch (error) {
    console.error('Error saving data:', error)
  }
}

function getNewSettings(film_id, translator_id) {
  return new Promise(resolve => {
    try {
      const script = document.createElement('script')
      script.src = chrome.runtime.getURL(
        'src/js/injection_scripts/update_translate_info.js',
      )
      script.dataset.args = JSON.stringify({
        film_id: film_id,
        translator_id: translator_id,
      })
      document.documentElement.appendChild(script)

      const intervalId = setInterval(() => {
        if (script.dataset.result !== undefined) {
          clearInterval(intervalId)
          try {
            const result = JSON.parse(script.dataset.result)
            document.documentElement.removeChild(script)
            resolve(result)
          } catch (error) {
            console.error('Error parsing new settings:', error)
            resolve({ seasons: [], episodes: {} })
          }
        }
      }, 30)

      // Timeout після 10 секунд
      setTimeout(() => {
        clearInterval(intervalId)
        if (script.parentNode) {
          document.documentElement.removeChild(script)
        }
        console.error('New settings loading timeout')
        resolve({ seasons: [], episodes: {} })
      }, 10000)
    } catch (error) {
      console.error('Error in getNewSettings:', error)
      resolve({ seasons: [], episodes: {} })
    }
  })
}

function showCheckBox() {
  try {
    const checkbox = document.getElementsByClassName('serials')[0]
    if (checkbox) {
      checkbox.style.display = 'block'
    }
  } catch (error) {
    console.error('Error showing checkbox:', error)
  }
}

function displayValuesSeason() {
  try {
    displayQuality()
    displaySeasons()
    displayEpisodes()
    displayTranslators()
  } catch (error) {
    console.error('Error displaying season values:', error)
  }
}

function displayQuality() {
  try {
    const quality_selector = document.getElementById('quality-select')
    if (!quality_selector) return

    while (quality_selector.firstChild) {
      quality_selector.removeChild(quality_selector.firstChild)
    }

    if (popupDataPlayer.qualities && Array.isArray(popupDataPlayer.qualities)) {
      popupDataPlayer.qualities.forEach(item => {
        const optionElement = document.createElement('option')
        optionElement.text = item
        optionElement.value = item
        quality_selector.add(optionElement)
        if (item === popupDataVideo.quality) {
          optionElement.selected = true
        }
      })
    }
  } catch (error) {
    console.error('Error displaying quality:', error)
  }
}

function displayTranslators() {
  try {
    const voice_selector = document.getElementById('voice-select')
    if (!voice_selector) return

    while (voice_selector.firstChild) {
      voice_selector.removeChild(voice_selector.firstChild)
    }

    if (Object.keys(popupDataPlayer.translators).length === 0) {
      const optionElement = document.createElement('option')
      optionElement.text =
        chrome.i18n.getMessage('info_unknownVoice') || 'Невідома озвучка'
      optionElement.setAttribute('translator_id', popupDataVideo.translator_id)
      optionElement.selected = true
      voice_selector.add(optionElement)
    } else {
      const entries = Object.entries(popupDataPlayer.translators)
      for (const [key, value] of entries) {
        const optionElement = document.createElement('option')
        optionElement.text = key
        if (value === '376') {
          optionElement.text = key + '(ua)'
        }
        optionElement.setAttribute('translator_id', value)
        voice_selector.add(optionElement)
        if (value === popupDataVideo.translator_id) {
          optionElement.selected = true
        }
      }
    }
  } catch (error) {
    console.error('Error displaying translators:', error)
  }
}

function displaySeasons() {
  try {
    const season_selector = document.getElementById('season-select')
    if (!season_selector) return

    while (season_selector.firstChild) {
      season_selector.removeChild(season_selector.firstChild)
    }

    if (popupDataPlayer.seasons && Array.isArray(popupDataPlayer.seasons)) {
      popupDataPlayer.seasons.forEach(item => {
        const optionElement = document.createElement('option')
        optionElement.text = item
        optionElement.value = item
        season_selector.add(optionElement)
        if (
          item === popupDataVideo.season_id &&
          popupDataVideo.translator_id === popupDisplaySettings.translator_id
        ) {
          optionElement.selected = true
        }
      })
    }
  } catch (error) {
    console.error('Error displaying seasons:', error)
  }
}

function displayEpisodes() {
  try {
    const episode_selector = document.getElementById('episode-select')
    if (!episode_selector) return

    while (episode_selector.firstChild) {
      episode_selector.removeChild(episode_selector.firstChild)
    }

    let arr
    if (popupDataPlayer.episodes && popupDisplaySettings.season_start) {
      arr = popupDataPlayer.episodes[popupDisplaySettings.season_start]
    } else if (popupDataPlayer.episodes) {
      const firstSeason = Object.keys(popupDataPlayer.episodes)[0]
      if (firstSeason) {
        arr = popupDataPlayer.episodes[firstSeason]
      }
    }

    if (arr && Array.isArray(arr)) {
      arr.forEach(item => {
        const optionElement = document.createElement('option')
        optionElement.text = item
        optionElement.value = item
        episode_selector.add(optionElement)
        if (
          item === popupDataVideo.episode_id &&
          popupDisplaySettings.season_start === popupDataVideo.season_id &&
          popupDisplaySettings.translator_id === popupDataVideo.translator_id
        ) {
          optionElement.selected = true
        }
      })
    }
  } catch (error) {
    console.error('Error displaying episodes:', error)
  }
}

async function saveCurrentSettings() {
  try {
    const create_folder = document.getElementById('create-folder')
    const downloadSeries = document.getElementById('load-entire-series')
    const change_quality = document.getElementById('quality-select')
    const change_parallel = document.getElementById('parallel-select')
    const change_translate = document.getElementById('voice-select')
    const change_season = document.getElementById('season-select')
    const change_episode = document.getElementById('episode-select')

    popupDisplaySettings.create_folder = create_folder
      ? create_folder.checked
      : false
    popupDisplaySettings.load_all_series = downloadSeries
      ? downloadSeries.checked
      : false
    popupDisplaySettings.parallel_downloads = change_parallel
      ? Number.parseInt(change_parallel.value)
      : 2
    popupDisplaySettings.quality = change_quality ? change_quality.value : ''

    if (change_translate && change_translate.selectedOptions[0]) {
      popupDisplaySettings.translator_id =
        change_translate.selectedOptions[0].getAttribute('translator_id')
      popupDisplaySettings.season_start = change_season
        ? change_season.value
        : ''
      popupDisplaySettings.episode_start = change_episode
        ? change_episode.value
        : ''
    }

    await saveData()
  } catch (error) {
    console.error('Error saving current settings:', error)
  }
}

function displayCurrentSettings() {
  try {
    const create_folder = document.getElementById('create-folder')
    const downloadSeries = document.getElementById('load-entire-series')
    const change_quality = document.getElementById('quality-select')
    const change_parallel = document.getElementById('parallel-select')
    const change_translate = document.getElementById('voice-select')
    const change_season = document.getElementById('season-select')
    const change_episode = document.getElementById('episode-select')

    if (create_folder)
      create_folder.checked = popupDisplaySettings.create_folder || false
    if (downloadSeries)
      downloadSeries.checked = popupDisplaySettings.load_all_series || false
    if (change_quality)
      change_quality.value = popupDisplaySettings.quality || ''
    if (change_parallel)
      change_parallel.value = popupDisplaySettings.parallel_downloads || 2

    if (popupDisplaySettings.translator_id && change_translate) {
      const translatorOption = change_translate.querySelector(
        `[translator_id="${popupDisplaySettings.translator_id}"]`,
      )
      if (translatorOption) {
        translatorOption.selected = true
      }
    }

    if (popupDisplaySettings.translator_id === popupDataVideo.translator_id) {
      if (change_season)
        change_season.value = popupDisplaySettings.season_start || ''
      if (change_episode)
        change_episode.value = popupDisplaySettings.episode_start || ''
    }

    // Тригерити події для оновлення UI
    if (downloadSeries) {
      const changeEvent = new Event('change', { bubbles: true })
      downloadSeries.dispatchEvent(changeEvent)
    }
  } catch (error) {
    console.error('Error displaying current settings:', error)
  }
}

async function updateDisplay(frames) {
  try {
    if (!frames || typeof frames !== 'object') {
      console.error('Invalid frames for update display:', frames)
      return
    }

    popupDataPlayer.seasons = frames.seasons || []
    popupDataPlayer.episodes = frames.episodes || {}
    displaySeasons()

    const season_selector = document.getElementById('season-select')
    if (season_selector) {
      popupDisplaySettings.season_start = season_selector.value
    }

    displayEpisodes()

    const episode_selector = document.getElementById('episode-select')
    if (episode_selector) {
      popupDisplaySettings.episode_start = episode_selector.value
    }

    await saveData()
  } catch (error) {
    console.error('Error updating display:', error)
  }
}

// Експорт функцій для handler.js
window.popupAPI = {
  getCurrentTab: () => popupCurrentTab,
  getDisplaySettings: () => popupDisplaySettings,
  getDataVideo: () => popupDataVideo,
  getDataPlayer: () => popupDataPlayer,
  saveData: saveData,
  getNewSettings: getNewSettings,
  showCheckBox: showCheckBox,
  displayValuesSeason: displayValuesSeason,
  displayQuality: displayQuality,
  displaySeasons: displaySeasons,
  displayEpisodes: displayEpisodes,
  displayTranslators: displayTranslators,
  saveCurrentSettings: saveCurrentSettings,
  displayCurrentSettings: displayCurrentSettings,
  updateDisplay: updateDisplay,
}
