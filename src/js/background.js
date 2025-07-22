let isWorking = false
let failedDownloads = []

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'start_download') {
    if (!isWorking) {
      startDownload(message.tabId)
        .then(() => sendResponse({ success: true }))
        .catch(error => {
          console.error('Download error:', error)
          sendResponse({ success: false, error: error.message })
        })
    } else {
      sendResponse({ success: false, error: 'Already working' })
    }
    return true
  }
})

async function startDownload(tabId) {
  if (isWorking) return
  isWorking = true
  failedDownloads = []

  try {
    // Отримати дані з storage
    const data = await chrome.storage.local.get([tabId.toString()])
    const settings = data[tabId.toString()]

    if (!settings) {
      throw new Error('No settings found')
    }

    const downloads = []

    if (settings.displaySettings.load_all_series) {
      // Завантажити всі серії
      const seasons = settings.dataPlayer.seasons
      const episodes = settings.dataPlayer.episodes
      const startSeasonIndex = seasons.indexOf(
        settings.displaySettings.season_start,
      )

      for (let i = startSeasonIndex; i < seasons.length; i++) {
        const seasonId = seasons[i]
        const seasonEpisodes = episodes[seasonId]
        const startEpisodeIndex =
          i === startSeasonIndex
            ? seasonEpisodes.indexOf(settings.displaySettings.episode_start)
            : 0

        for (let j = startEpisodeIndex; j < seasonEpisodes.length; j++) {
          const episodeId = seasonEpisodes[j]
          downloads.push({
            film_id: settings.dataVideo.film_id,
            translator_id: settings.displaySettings.translator_id,
            season_id: seasonId,
            episode_id: episodeId,
            action: settings.dataVideo.action,
            quality: settings.displaySettings.quality,
            filename: settings.dataVideo.filename,
          })
        }
      }
    } else {
      // Завантажити одну серію
      downloads.push({
        film_id: settings.dataVideo.film_id,
        translator_id: settings.displaySettings.translator_id,
        season_id: settings.dataVideo.season_id,
        episode_id: settings.dataVideo.episode_id,
        action: settings.dataVideo.action,
        quality: settings.displaySettings.quality,
        filename: settings.dataVideo.filename,
      })
    }

    console.log(`Starting ${downloads.length} downloads`)

    // Запустити всі завантаження паралельно з невеликою затримкою
    const downloadPromises = downloads.map(
      (downloadData, index) =>
        new Promise(resolve => {
          setTimeout(() => {
            processDownload(tabId, downloadData).then(resolve)
          }, index * 500) // 500ms затримка між запитами
        }),
    )

    await Promise.allSettled(downloadPromises)

    // Спробувати повторно завантажити невдалі серії
    if (failedDownloads.length > 0) {
      console.log(
        `Retrying ${failedDownloads.length} failed downloads after 5 seconds...`,
      )
      await new Promise(resolve => setTimeout(resolve, 5000)) // Чекати 5 секунд

      const retryPromises = failedDownloads.map(
        (downloadData, index) =>
          new Promise(resolve => {
            setTimeout(() => {
              processDownloadWithRetry(tabId, downloadData, 3).then(resolve) // 3 спроби
            }, index * 1000) // 1 секунда між повторними спробами
          }),
      )

      await Promise.allSettled(retryPromises)
    }

    console.log('All downloads processed')
  } finally {
    isWorking = false
  }
}

async function processDownload(tabId, downloadData) {
  try {
    const targetTab = { tabId: tabId, allFrames: false }

    // Отримати URL для завантаження
    const result = await chrome.scripting.executeScript({
      target: targetTab,
      func: getVideoURLWithFetch,
      args: [downloadData],
    })

    const response = result[0].result

    if (!response.success) {
      console.log(
        `Failed to get URLs for S${downloadData.season_id}E${downloadData.episode_id}: ${response.error}`,
      )

      // Додати до списку невдалих завантажень для повторної спроби
      if (response.shouldRetry) {
        failedDownloads.push(downloadData)
      }
      return
    }

    const urls = response.urls
    if (!urls || urls.length === 0) {
      console.error(
        `No URLs found for S${downloadData.season_id}E${downloadData.episode_id}`,
      )
      failedDownloads.push(downloadData)
      return
    }

    // Створити ім'я файлу
    let filename = downloadData.filename.replace(/[<>:"/\\|?*]/g, '_')
    if (downloadData.action === 'get_movie') {
      filename += '.mp4'
    } else {
      filename += `_S${downloadData.season_id}E${downloadData.episode_id}.mp4`
    }

    // Спробувати завантажити з першого доступного URL
    let downloadStarted = false
    for (const url of urls) {
      try {
        const downloadId = await new Promise((resolve, reject) => {
          chrome.downloads.download(
            {
              url: url,
              filename: filename,
              saveAs: false,
            },
            downloadId => {
              if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message))
              } else {
                resolve(downloadId)
              }
            },
          )
        })

        console.log(`✅ Started download: ${filename} with ID: ${downloadId}`)
        downloadStarted = true
        break
      } catch (error) {
        console.log(`❌ Failed to download from ${url}:`, error.message)
      }
    }

    if (!downloadStarted) {
      console.error(
        `❌ All URLs failed for S${downloadData.season_id}E${downloadData.episode_id}`,
      )
      failedDownloads.push(downloadData)
    }
  } catch (error) {
    console.error(
      `❌ Process download error for S${downloadData.season_id}E${downloadData.episode_id}:`,
      error,
    )
    failedDownloads.push(downloadData)
  }
}

async function processDownloadWithRetry(tabId, downloadData, maxRetries) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    console.log(
      `🔄 Retry attempt ${attempt}/${maxRetries} for S${downloadData.season_id}E${downloadData.episode_id}`,
    )

    try {
      const targetTab = { tabId: tabId, allFrames: false }

      const result = await chrome.scripting.executeScript({
        target: targetTab,
        func: getVideoURLWithFetch,
        args: [downloadData],
      })

      const response = result[0].result

      if (response.success && response.urls && response.urls.length > 0) {
        // Створити ім'я файлу
        let filename = downloadData.filename.replace(/[<>:"/\\|?*]/g, '_')
        if (downloadData.action === 'get_movie') {
          filename += '.mp4'
        } else {
          filename += `_S${downloadData.season_id}E${downloadData.episode_id}.mp4`
        }

        // Спробувати завантажити
        for (const url of response.urls) {
          try {
            const downloadId = await new Promise((resolve, reject) => {
              chrome.downloads.download(
                {
                  url: url,
                  filename: filename,
                  saveAs: false,
                },
                downloadId => {
                  if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message))
                  } else {
                    resolve(downloadId)
                  }
                },
              )
            })

            console.log(
              `✅ Retry successful: ${filename} with ID: ${downloadId}`,
            )
            return // Успішно завантажено
          } catch (error) {
            console.log(`❌ Retry download failed from ${url}:`, error.message)
          }
        }
      }

      if (attempt < maxRetries) {
        // Чекати перед наступною спробою (експоненційна затримка)
        const delay = Math.pow(2, attempt) * 1000
        console.log(`⏳ Waiting ${delay}ms before next retry...`)
        await new Promise(resolve => setTimeout(resolve, delay))
      }
    } catch (error) {
      console.error(
        `❌ Retry error for S${downloadData.season_id}E${downloadData.episode_id}:`,
        error,
      )
      if (attempt < maxRetries) {
        const delay = Math.pow(2, attempt) * 1000
        await new Promise(resolve => setTimeout(resolve, delay))
      }
    }
  }

  console.error(
    `❌ All retry attempts failed for S${downloadData.season_id}E${downloadData.episode_id}`,
  )
}

// Функція яка використовує нативний fetch API з покращеною обробкою помилок
function getVideoURLWithFetch(downloadData) {
  return new Promise(async resolve => {
    try {
      const t = new Date().getTime()

      // Отримати значення ctrl_favs
      let favsValue = ''
      try {
        const favsElement = document.getElementById('ctrl_favs')
        if (favsElement) {
          favsValue = favsElement.value
        }
      } catch (e) {
        console.log('Could not get ctrl_favs value:', e)
      }

      // Створити FormData для POST запиту
      const formData = new FormData()
      formData.append('id', downloadData.film_id)
      formData.append('translator_id', downloadData.translator_id)
      formData.append('season', downloadData.season_id)
      formData.append('episode', downloadData.episode_id)
      formData.append('favs', favsValue)
      formData.append('action', downloadData.action)

      const response = await fetch(`/ajax/get_cdn_series/?t=${t}`, {
        method: 'POST',
        body: formData,
        headers: {
          'X-Requested-With': 'XMLHttpRequest',
        },
      })

      if (!response.ok) {
        const shouldRetry = response.status >= 500 || response.status === 429 // Server errors or rate limiting
        resolve({
          success: false,
          error: `HTTP ${response.status}: ${response.statusText}`,
          shouldRetry: shouldRetry,
        })
        return
      }

      const data = await response.json()

      if (!data.success || !data.url) {
        resolve({
          success: false,
          error: 'Invalid response data',
          shouldRetry: true,
        })
        return
      }

      // Очистити та декодувати URL
      let cleanUrl = data.url
      const trashList = [
        '//_//QEBAQEAhIyMhXl5e',
        '//_//Xl5eIUAjIyEhIyM=',
        '//_//JCQhIUAkJEBeIUAjJCRA',
        '//_//IyMjI14hISMjIUBA',
        '//_//JCQjISFAIyFAIyM=',
      ]

      // Очистити сміття
      while (
        trashList.filter(subString => cleanUrl.includes(subString)).length !== 0
      ) {
        cleanUrl = cleanUrl.replace(new RegExp(trashList.join('|'), 'g'), '')
      }
      cleanUrl = cleanUrl.replace('#h', '')
      cleanUrl = atob(cleanUrl)

      // Парсити URL за якістю
      const urlsByQuality = {}
      cleanUrl.split(',').forEach(item => {
        const qualityMatch = item.match(/\[.*?]/)
        if (qualityMatch) {
          const quality = qualityMatch[0]
          const urls = item
            .slice(quality.length)
            .split(/\sor\s/)
            .filter(url => /https?:\/\/.*mp4$/.test(url))
          if (urls.length > 0) {
            urlsByQuality[quality] = urls
          }
        }
      })

      // Знайти URL для потрібної якості
      const targetQuality = `[${downloadData.quality}]`
      let finalUrls = []

      if (urlsByQuality[targetQuality]) {
        finalUrls = urlsByQuality[targetQuality]
      } else {
        // Взяти першу доступну якість
        const qualities = Object.keys(urlsByQuality)
        if (qualities.length > 0) {
          finalUrls = urlsByQuality[qualities[0]]
        }
      }

      if (finalUrls.length > 0) {
        resolve({
          success: true,
          urls: finalUrls,
        })
      } else {
        resolve({
          success: false,
          error: 'No valid URLs found',
          shouldRetry: true,
        })
      }
    } catch (error) {
      console.error('Error in getVideoURLWithFetch:', error)
      resolve({
        success: false,
        error: error.message,
        shouldRetry: true,
      })
    }
  })
}
