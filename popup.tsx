import { useState, useEffect } from "react"

interface ScrapedTweet {
  text: string;
  timestamp?: string;
  author?: string;
  isThread?: boolean;
  threadTweets?: string[];
  threadPosition?: number;
  quotedTweetUrl?: string;
  mediaUrls?: string[];
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
    const headers = ['Tweet Text', 'Author', 'Timestamp', 'Is Thread', 'Thread Position', 'Full Thread', 'Quoted Tweet URL', 'Media URLs']
    const rows = tweets.map(tweet => [
      `"${tweet.text.replace(/"/g, '""')}"`,
      `"${tweet.author || 'Unknown'}"`,
      `"${tweet.timestamp || 'Unknown'}"`,
      `"${tweet.isThread ? 'Yes' : 'No'}"`,
      `"${tweet.threadPosition || ''}"`,
      `"${tweet.isThread && tweet.threadTweets ? tweet.threadTweets.map(t => t.replace(/"/g, '""')).join(' | ') : ''}"`,
      `"${tweet.quotedTweetUrl || ''}"`,
      `"${tweet.mediaUrls ? tweet.mediaUrls.join(' | ') : ''}"`
    ])
    
    return [headers.join(','), ...rows.map(row => row.join(','))].join('\n')
  }

  return (
    <div style={{ 
      width: 350, 
      padding: 16, 
      fontFamily: '"JetBrains Mono", "Fira Code", "SF Mono", "Monaco", "Consolas", monospace',
      backgroundColor: '#fefefe',
      color: '#2d5016'
    }}>
      <div style={{ 
        display: 'flex', 
        alignItems: 'center', 
        margin: '0 0 16px 0',
        gap: '8px'
      }}>
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
          <rect x="2" y="4" width="20" height="16" rx="2" stroke="#2d5016" strokeWidth="1.5" fill="none"/>
          <path d="M6 8h8M6 12h12M6 16h6" stroke="#6b8e3d" strokeWidth="1.5" strokeLinecap="round"/>
          <circle cx="18" cy="8" r="2" fill="#a3c55f"/>
          <path d="M16 10l4 4" stroke="#6b8e3d" strokeWidth="1.5" strokeLinecap="round"/>
        </svg>
        <h3 style={{ margin: 0, color: '#2d5016', fontSize: '18px', fontWeight: 600 }}>
          ScrollNScrape
        </h3>
      </div>
      
      {!isOnTwitter && (
        <div style={{ 
          background: '#fff8e1', 
          border: '1px solid #a3c55f', 
          padding: 8, 
          borderRadius: 6, 
          marginBottom: 16,
          fontSize: '13px',
          color: '#2d5016'
        }}>
          ⚠️ Please navigate to a X.com profile page to use this extension
        </div>
      )}

      <div style={{ marginBottom: 16 }}>
        <label style={{ display: 'block', marginBottom: 8, fontWeight: 600, fontSize: '14px', color: '#2d5016' }}>
          Scraping Options:
        </label>
        
        <div style={{ marginBottom: 8 }}>
          <label style={{ display: 'flex', alignItems: 'center', marginBottom: 4, fontSize: '13px', cursor: 'pointer' }}>
            <input
              type="radio"
              value="all"
              checked={scrapeMode === 'all'}
              onChange={(e) => setScrapeMode(e.target.value as ScrapeMode)}
              style={{ marginRight: 8, accentColor: '#a3c55f' }}
            />
            Scrape all tweets
          </label>
        </div>

        <div style={{ marginBottom: 8 }}>
          <label style={{ display: 'flex', alignItems: 'center', marginBottom: 4, fontSize: '13px', cursor: 'pointer' }}>
            <input
              type="radio"
              value="count"
              checked={scrapeMode === 'count'}
              onChange={(e) => setScrapeMode(e.target.value as ScrapeMode)}
              style={{ marginRight: 8, accentColor: '#a3c55f' }}
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
                padding: 6, 
                border: '1px solid #6b8e3d', 
                borderRadius: 4,
                width: 120,
                fontSize: '13px',
                backgroundColor: '#fefefe',
                color: '#2d5016'
              }}
            />
          )}
        </div>

        <div style={{ marginBottom: 8 }}>
          <label style={{ display: 'flex', alignItems: 'center', marginBottom: 4, fontSize: '13px', cursor: 'pointer' }}>
            <input
              type="radio"
              value="date"
              checked={scrapeMode === 'date'}
              onChange={(e) => setScrapeMode(e.target.value as ScrapeMode)}
              style={{ marginRight: 8, accentColor: '#a3c55f' }}
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
                  padding: 6, 
                  border: '1px solid #6b8e3d', 
                  borderRadius: 4,
                  width: '100%',
                  fontSize: '13px',
                  backgroundColor: '#fefefe',
                  color: '#2d5016'
                }}
              />
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                style={{ 
                  padding: 6, 
                  border: '1px solid #6b8e3d', 
                  borderRadius: 4,
                  width: '100%',
                  fontSize: '13px',
                  backgroundColor: '#fefefe',
                  color: '#2d5016'
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
            background: isActive ? '#d32f2f' : '#6b8e3d',
            color: 'white',
            border: 'none',
            padding: '10px 16px',
            borderRadius: 6,
            cursor: isOnTwitter ? 'pointer' : 'not-allowed',
            width: '100%',
            marginBottom: 8,
            fontSize: '13px',
            fontWeight: 600,
            fontFamily: 'inherit'
          }}
        >
          {isActive ? 'Stop Scraping' : 'Start Scraping'}
        </button>

        {scrapedTweets.length > 0 && (
          <button
            onClick={downloadCSV}
            style={{
              background: '#a3c55f',
              color: '#2d5016',
              border: 'none',
              padding: '10px 16px',
              borderRadius: 6,
              cursor: 'pointer',
              width: '100%',
              fontSize: '13px',
              fontWeight: 600,
              fontFamily: 'inherit'
            }}
          >
            Download CSV ({scrapedTweets.length} tweets)
          </button>
        )}
      </div>

      <div style={{ 
        background: '#f8fdf4', 
        padding: 10, 
        borderRadius: 6, 
        fontSize: '13px',
        border: '1px solid #e8f5e8'
      }}>
        <div style={{ marginBottom: 4 }}>
          <span style={{ fontWeight: 600, color: '#2d5016' }}>Status:</span> 
          <span style={{ marginLeft: 8 }}>{status}</span>
        </div>
        <div>
          <span style={{ fontWeight: 600, color: '#2d5016' }}>Tweets found:</span> 
          <span style={{ marginLeft: 8 }}>{tweetCount}</span>
        </div>
      </div>
    </div>
  )
}

export default IndexPopup
