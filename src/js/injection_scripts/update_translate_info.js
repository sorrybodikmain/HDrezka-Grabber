;(() => {
  console.log('load update_translate_info success')
  const thisScript = document.currentScript
  const args = JSON.parse(thisScript.dataset.args)

  const dictionary = {}
  dictionary['seasons'] = []
  dictionary['episodes'] = {}

  updateTranslateInfo(args).then(result => {
    thisScript.dataset.result = JSON.stringify(result)
  })
})()

async function updateTranslateInfo(args) {
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
    formData.append('id', args.film_id)
    formData.append('translator_id', args.translator_id)
    formData.append('favs', favsValue)
    formData.append('action', 'get_episodes')

    const response = await fetch(`/ajax/get_cdn_series/?t=${t}`, {
      method: 'POST',
      body: formData,
      headers: {
        'X-Requested-With': 'XMLHttpRequest',
      },
    })

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`)
    }

    const data = await response.json()

    const dictionary = {}
    dictionary['seasons'] = []
    dictionary['episodes'] = {}

    const seasonsList = data.episodes
      .split(`</ul>`)
      .filter(item => item.trim() !== '')
    for (let i = 0; i < seasonsList.length; i++) {
      const seasonId = seasonsList[i].match(
        /id="simple-episodes-list-(\d*)"/,
      )[1]
      dictionary.seasons.push(seasonId)
      const episodes = []

      const episodeItems = seasonsList[i]
        .split(`</li>`)
        .filter(item => item.trim() !== '')
      for (let j = 0; j < episodeItems.length; j++) {
        const episodeId = episodeItems[j].match(/data-episode_id="(\d*)"/)[1]
        episodes.push(episodeId)
      }
      dictionary.episodes[seasonId] = episodes
    }

    return dictionary
  } catch (error) {
    console.error('Error in updateTranslateInfo:', error)
    return { seasons: [], episodes: {} }
  }
}
