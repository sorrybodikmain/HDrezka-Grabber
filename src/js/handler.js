// Чекаємо поки API буде доступне
function waitForAPI() {
  return new Promise(resolve => {
    const checkAPI = () => {
      if (window.popupAPI) {
        resolve(window.popupAPI)
      } else {
        setTimeout(checkAPI, 100)
      }
    }
    checkAPI()
  })
}

// Ініціалізація handler після завантаження API
waitForAPI().then(api => {
  const grabBtn = document.getElementById('load_btn')
  const downloadSeries = document.getElementById('load-entire-series')
  const fieldsContainer = document.getElementById('fields-container')
  const startDownloadText = document.querySelector('.container h2')
  const change_season = document.getElementById('season-select')
  const change_episode = document.getElementById('episode-select')
  const change_translate = document.getElementById('voice-select')
  const change_quality = document.getElementById('quality-select')

  if (!grabBtn) {
    console.error('Download button not found')
    return
  }

  grabBtn.addEventListener('click', async () => {
    try {
      const currentTab = api.getCurrentTab()

      if (currentTab.isHdrezka) {
        // Показати, що завантаження почалося
        grabBtn.textContent = 'Завантаження...'
        grabBtn.disabled = true

        try {
          // Надіслати повідомлення для початку завантаження
          const response = await chrome.runtime.sendMessage({
            action: 'start_download',
            tabId: currentTab.id,
          })

          if (response && response.success) {
            grabBtn.textContent = 'Запущено!'
          } else {
            grabBtn.textContent = 'Помилка'
            console.error(
              'Download failed:',
              response?.error || 'Unknown error',
            )
          }
        } catch (error) {
          grabBtn.textContent = 'Помилка'
          console.error('Message sending failed:', error)
        }

        // Повернути кнопку в нормальний стан
        setTimeout(() => {
          grabBtn.textContent = ''
          grabBtn.disabled = false
        }, 3000)
      }
    } catch (error) {
      console.error('Error in download button click:', error)
      grabBtn.textContent = 'Помилка'
      grabBtn.disabled = false
    }
  })

  if (downloadSeries) {
    downloadSeries.addEventListener('change', async () => {
      try {
        const displaySettings = api.getDisplaySettings()
        const select_value = downloadSeries.checked
        displaySettings.load_all_series = select_value
        await api.saveData()

        if (select_value) {
          if (fieldsContainer) fieldsContainer.style.display = 'block'
          if (startDownloadText) startDownloadText.style.display = 'block'
        } else {
          if (fieldsContainer) fieldsContainer.style.display = 'none'
          if (startDownloadText) startDownloadText.style.display = 'none'
        }
      } catch (error) {
        console.error('Error in download series change:', error)
      }
    })
  }

  if (change_season) {
    change_season.addEventListener('change', async event => {
      try {
        const displaySettings = api.getDisplaySettings()
        displaySettings.season_start = event.target.value
        await api.saveData()
        api.displayEpisodes()
      } catch (error) {
        console.error('Error in season change:', error)
      }
    })
  }

  if (change_episode) {
    change_episode.addEventListener('change', async event => {
      try {
        const displaySettings = api.getDisplaySettings()
        displaySettings.episode_start = event.target.value
        await api.saveData()
      } catch (error) {
        console.error('Error in episode change:', error)
      }
    })
  }

  if (change_translate) {
    change_translate.addEventListener('change', async event => {
      try {
        const displaySettings = api.getDisplaySettings()
        const dataVideo = api.getDataVideo()
        const currentTab = api.getCurrentTab()

        const select_value =
          event.target.selectedOptions[0]?.getAttribute('translator_id')
        if (!select_value) return

        displaySettings.translator_id = select_value
        await api.saveData()

        const result = await chrome.scripting.executeScript({
          target: { tabId: currentTab.id, allFrames: false },
          func: api.getNewSettings,
          args: [dataVideo.film_id, select_value],
        })

        if (result && result[0] && result[0].result) {
          await api.updateDisplay(result[0].result)
        }
      } catch (error) {
        console.error('Failed to update translator settings:', error)
      }
    })
  }

  if (change_quality) {
    change_quality.addEventListener('change', async event => {
      try {
        const displaySettings = api.getDisplaySettings()
        displaySettings.quality = event.target.value
        await api.saveData()
      } catch (error) {
        console.error('Error in quality change:', error)
      }
    })
  }
})
