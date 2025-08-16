import { useState, useEffect } from "react"

interface ScrapedTweet {
  text: string;
  timestamp?: string;
  author?: string;
  isThread?: boolean;
  threadTweets?: string[];
  threadPosition?: number;
}

type ScrapeMode = 'all' | 'count' | 'date'

function IndexPopup() {
  const [scrapeMode, setScrapeMode] = useState<ScrapeMode>('all')
  const [maxTweets, setMaxTweets] = useState<string>('100')
  const [startDate, setStartDate] = useState<string>('')
  const [endDate, setEndDate] = useState<string>('')
  const [isActive, setIsActive] = useState(false)
  const [status, setStatus] = useState<string>('Ready to scrape')
  const [tweetCount, setTweetCount] = useState(0)
  const [scrapedTweets, setScrapedTweets] = useState<ScrapedTweet[]>([])
  const [isOnTwitter, setIsOnTwitter] = useState(false)

  useEffect(() => {
    checkCurrentTab()
    setupMessageListener()
  }, [])

  const checkCurrentTab = async () => {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true })
    const currentTab = tabs[0]
    
    if (currentTab?.url) {
      const url = new URL(currentTab.url)
      setIsOnTwitter(url.hostname === 'x.com' || url.hostname === 'twitter.com')
    }
  }

  const setupMessageListener = () => {
    chrome.runtime.onMessage.addListener((message) => {
      switch (message.action) {
        case 'STATUS_UPDATE':
          setStatus(message.message)
          setTweetCount(message.tweetCount)
          break
        case 'SCRAPING_COMPLETE':
          setIsActive(false)
          setStatus('Scraping completed!')
          setTweetCount(message.tweetCount)
          setScrapedTweets(message.tweets)
          break
      }
    })
  }

  const sendMessageToActiveTab = async (message: any) => {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true })
    if (tabs[0]?.id) {
      return chrome.tabs.sendMessage(tabs[0].id, message)
    }
  }

  const startScraping = async () => {
    if (!isOnTwitter) {
      setStatus('Please navigate to a X.com profile page')
      return
    }

    const config = {
      scrapeAll: scrapeMode === 'all',
      maxTweets: scrapeMode === 'count' ? parseInt(maxTweets) : undefined,
      dateRange: scrapeMode === 'date' ? { start: startDate, end: endDate } : undefined
    }

    setIsActive(true)
    setStatus('Starting scraper...')
    setTweetCount(0)
    setScrapedTweets([])

    await sendMessageToActiveTab({
      action: 'START_SCRAPING',
      config
    })
  }

  const stopScraping = async () => {
    await sendMessageToActiveTab({ action: 'STOP_SCRAPING' })
    setIsActive(false)
    setStatus('Scraping stopped')
  }

  const downloadCSV = () => {
    if (scrapedTweets.length === 0) return

    const csvContent = convertToCSV(scrapedTweets)
    const blob = new Blob([csvContent], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    
    const a = document.createElement('a')
    a.href = url
    a.download = `tweets_${new Date().toISOString().split('T')[0]}.csv`
    a.click()
    
    URL.revokeObjectURL(url)
  }

  const convertToCSV = (tweets: ScrapedTweet[]): string => {
    const headers = ['Tweet Text', 'Author', 'Timestamp', 'Is Thread', 'Thread Position', 'Full Thread']
    const rows = tweets.map(tweet => [
      `"${tweet.text.replace(/"/g, '""')}"`,
      `"${tweet.author || 'Unknown'}"`,
      `"${tweet.timestamp || 'Unknown'}"`,
      `"${tweet.isThread ? 'Yes' : 'No'}"`,
      `"${tweet.threadPosition || ''}"`,
      `"${tweet.isThread && tweet.threadTweets ? tweet.threadTweets.map(t => t.replace(/"/g, '""')).join(' | ') : ''}"`
    ])
    
    return [headers.join(','), ...rows.map(row => row.join(','))].join('\n')
  }

  return (
    <div style={{ width: 350, padding: 16 }}>
      <h3 style={{ margin: '0 0 16px 0', color: '#1d9bf0' }}>
        Twitter Scraper
      </h3>
      
      {!isOnTwitter && (
        <div style={{ 
          background: '#fff3cd', 
          border: '1px solid #ffeaa7', 
          padding: 8, 
          borderRadius: 4, 
          marginBottom: 16,
          fontSize: '14px'
        }}>
          ⚠️ Please navigate to a X.com profile page to use this extension
        </div>
      )}

      <div style={{ marginBottom: 16 }}>
        <label style={{ display: 'block', marginBottom: 8, fontWeight: 'bold' }}>
          Scraping Options:
        </label>
        
        <div style={{ marginBottom: 8 }}>
          <label style={{ display: 'flex', alignItems: 'center', marginBottom: 4 }}>
            <input
              type="radio"
              value="all"
              checked={scrapeMode === 'all'}
              onChange={(e) => setScrapeMode(e.target.value as ScrapeMode)}
              style={{ marginRight: 8 }}
            />
            Scrape all tweets
          </label>
        </div>

        <div style={{ marginBottom: 8 }}>
          <label style={{ display: 'flex', alignItems: 'center', marginBottom: 4 }}>
            <input
              type="radio"
              value="count"
              checked={scrapeMode === 'count'}
              onChange={(e) => setScrapeMode(e.target.value as ScrapeMode)}
              style={{ marginRight: 8 }}
            />
            Limit to specific number
          </label>
          {scrapeMode === 'count' && (
            <input
              type="number"
              value={maxTweets}
              onChange={(e) => setMaxTweets(e.target.value)}
              placeholder="Number of tweets"
              style={{ 
                marginLeft: 24, 
                padding: 4, 
                border: '1px solid #ccc', 
                borderRadius: 4,
                width: 120
              }}
            />
          )}
        </div>

        <div style={{ marginBottom: 8 }}>
          <label style={{ display: 'flex', alignItems: 'center', marginBottom: 4 }}>
            <input
              type="radio"
              value="date"
              checked={scrapeMode === 'date'}
              onChange={(e) => setScrapeMode(e.target.value as ScrapeMode)}
              style={{ marginRight: 8 }}
            />
            Date range (experimental)
          </label>
          {scrapeMode === 'date' && (
            <div style={{ marginLeft: 24 }}>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                style={{ 
                  marginBottom: 4, 
                  padding: 4, 
                  border: '1px solid #ccc', 
                  borderRadius: 4,
                  width: '100%'
                }}
              />
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                style={{ 
                  padding: 4, 
                  border: '1px solid #ccc', 
                  borderRadius: 4,
                  width: '100%'
                }}
              />
            </div>
          )}
        </div>
      </div>

      <div style={{ marginBottom: 16 }}>
        <button
          onClick={isActive ? stopScraping : startScraping}
          disabled={!isOnTwitter}
          style={{
            background: isActive ? '#dc3545' : '#1d9bf0',
            color: 'white',
            border: 'none',
            padding: '8px 16px',
            borderRadius: 6,
            cursor: isOnTwitter ? 'pointer' : 'not-allowed',
            width: '100%',
            marginBottom: 8
          }}
        >
          {isActive ? 'Stop Scraping' : 'Start Scraping'}
        </button>

        {scrapedTweets.length > 0 && (
          <button
            onClick={downloadCSV}
            style={{
              background: '#28a745',
              color: 'white',
              border: 'none',
              padding: '8px 16px',
              borderRadius: 6,
              cursor: 'pointer',
              width: '100%'
            }}
          >
            Download CSV ({scrapedTweets.length} tweets)
          </button>
        )}
      </div>

      <div style={{ 
        background: '#f8f9fa', 
        padding: 8, 
        borderRadius: 4, 
        fontSize: '14px'
      }}>
        <div><strong>Status:</strong> {status}</div>
        <div><strong>Tweets found:</strong> {tweetCount}</div>
      </div>

      <div style={{ 
        fontSize: '12px', 
        color: '#666', 
        marginTop: 12, 
        textAlign: 'center' 
      }}>
        ⚠️ Use responsibly. Respect X.com's terms of service.
      </div>
    </div>
  )
}

export default IndexPopup
