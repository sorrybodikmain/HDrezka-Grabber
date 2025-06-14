;(() => {
  console.log('load loader success')
  const thisScript = document.currentScript
  const args = JSON.parse(thisScript.dataset.args)
  console.log(args)
  getVideoURL(args).then(result => {
    thisScript.dataset.result = JSON.stringify({ url: result })
  })
})()

async function getVideoURL(dictionary) {
  const response = await sendRequest(
    dictionary.film_id,
    dictionary.translator_id,
    dictionary.season_id,
    dictionary.episode_id,
    dictionary.action,
  )
  const url_dict = {}
  if (!response.success) {
    return false
  }
  clearTrash(response.url)
    .split(',')
    .forEach(item => {
      const links_quality = item.match(/\[.*?]/)[0]
      const urls_strings = item.slice(links_quality.length)
      url_dict[links_quality] = urls_strings
        .split(/\sor\s/)
        .filter(item => /https?:\/\/.*mp4$/.test(item))
    })
  let quality = `[${dictionary.quality}]`
  if (Object.keys(url_dict).length === 0) {
    return false
  } else if (url_dict[quality]) {
    return url_dict[quality]
  } else {
    const keys =
      typeof CDNPlayer !== 'undefined' && CDNPlayer.api('qualities')
        ? CDNPlayer.api('qualities').map(
            item => item.match(/\d*(?:(?:K)|(?:p(?:\sUltra)?))/)[0],
          )
        : []
    let index = keys.indexOf(dictionary.quality)
    while (index > 0 && !url_dict[quality]) {
      index -= 1
      quality = `[${keys[index]}]`
    }
    return url_dict[quality]
  }
}

function sendRequest(film_id, translator_id, season_id, episode_id, action) {
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
      formData.append('id', film_id)
      formData.append('translator_id', translator_id)
      formData.append('season', season_id)
      formData.append('episode', episode_id)
      formData.append('favs', favsValue)
      formData.append('action', action)

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
      resolve(data)
    } catch (error) {
      console.error('Fetch error:', error)
      resolve(false)
    }
  })
}

function clearTrash(data) {
  const trashList = [
    '//_//QEBAQEAhIyMhXl5e',
    '//_//Xl5eIUAjIyEhIyM=',
    '//_//JCQhIUAkJEBeIUAjJCRA',
    '//_//IyMjI14hISMjIUBA',
    '//_//JCQjISFAIyFAIyM=',
  ]
  while (trashList.filter(subString => data.includes(subString)).length !== 0) {
    data = data.replace(new RegExp(trashList.join('|'), 'g'), '')
  }
  data = data.replace('#h', '')
  return atob(data)
}
